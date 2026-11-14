import { effect, signal, batch } from '@preact/signals';
import { currentFilePath, currentFileContent, savedContent, isDirty, openTabs, closeTab } from './store';
import { putNote, isConnectionLost, reopenDB, isStorageFull, deviceStorageFull, STORAGE_FULL_MESSAGE } from './db';
import type { NoteDoc } from './db';
import { updateLinksForFile } from './markdown';
import { indexFile } from './search';
import { toast } from './toast';

export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved';
export const saveStatus = signal<SaveStatus>('clean');

export const AUTOSAVE_DELAY_MS = 1000;
/** Longest unsaved stretch while the user keeps typing. The debounce alone never fired during
 *  steady typing — a minute of text was one crash away from gone. */
export const AUTOSAVE_MAX_WAIT_MS = 5000;
/** After a failed save, try again on our own — the user may not type again. */
export const SAVE_RETRY_MS = 5000;
const SAVE_TIMEOUT_MS = 20_000;
let saveTimeout = SAVE_TIMEOUT_MS;

// Plain variables on purpose. These were signals read and written inside the
// autosave effect, which made the effect re-trigger itself every frame and
// re-arm the timer forever — the debounced save never fired.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let statusTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryBase = SAVE_RETRY_MS;
let retryDelay = SAVE_RETRY_MS;
let failStreak = 0;
let maxWait = AUTOSAVE_MAX_WAIT_MS;
// When the text that is waiting to be saved first became dirty.
let dirtySince: number | null = null;
let persistAsked = false;
// _rev of the note as the editor loaded (or last saved) it — see PutOptions.baseRev.
let openRev: { path: string; rev: string | undefined } | null = null;
// Saves run one at a time. Two overlapping saves of the same note both carry the
// same baseRev; the second then sees "the stored rev moved" and parks the
// first's text as a bogus conflict copy.
let chain: Promise<unknown> = Promise.resolve();
// Ids this tab is removing itself (rename). Their tombstones arrive on the
// change feed while the rename is still deciding what to show.
const localRemovals = new Set<string>();

function clearTimers(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

/** Put a note into the editor. Batched so the autosave effect never sees a
 *  half-switched state (new path with the previous note's text).
 *  `draft` is text the user already typed on top of `content` (carried across a
 *  rename): the note opens dirty and the debounce saves it. */
export function showNote(path: string | null, content: string, rev?: string, draft?: string): void {
  clearTimers();
  dirtySince = null;
  batch(() => {
    savedContent.value = content;
    currentFileContent.value = draft ?? content;
    currentFilePath.value = path;
  });
  openRev = path ? { path, rev } : null;
}

/** Record the stored _rev of the open note (after the change feed refreshed it). */
export function noteRevSeen(path: string, rev: string | undefined): void {
  if (openRev?.path === path) openRev.rev = rev;
}

function generation(rev: string | undefined): number {
  const n = rev ? parseInt(rev, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Mark ids this tab is about to remove so applyChange leaves the editor alone. */
export function expectLocalRemoval(id: string): () => void {
  localRemovals.add(id);
  return () => { localRemovals.delete(id); };
}

/**
 * A document changed in the store (this tab, another tab, or sync).
 * Decides what that means for the editor. Never touches unsaved edits: while
 * the open note is dirty the stored rev is deliberately not adopted, so the
 * next save sees it moved and keeps the incoming version as a conflict copy.
 */
export function applyChange(doc: NoteDoc & { _deleted?: boolean }): 'adopted' | 'closed' | 'ignored' {
  const id = doc._id;
  const gone = !!doc._deleted || !!doc.trashed || !!doc.deleted;
  const isCurrent = id === currentFilePath.peek();

  if (gone) {
    if (localRemovals.has(id)) return 'ignored';
    if (isCurrent) {
      // A tombstone carries no content. Adopting it used to blank the editor,
      // mark it dirty, and save "" back under the removed id.
      if (isDirty.peek()) return 'ignored';
      // Empty the editor first: closeTab alone would move currentFilePath to
      // another tab while the editor still holds this note's text.
      showNote(null, '');
      closeTab(id);
      return 'closed';
    }
    if (openTabs.peek().includes(id)) { closeTab(id); return 'closed'; }
    return 'ignored';
  }

  if (!isCurrent || isDirty.peek() || typeof doc.content !== 'string') return 'ignored';
  // Our own save echoes back on the feed. An echo of an older save must not
  // roll the editor back to that text.
  if (openRev?.path === id) {
    if (doc._rev === openRev.rev) return 'ignored';
    if (generation(doc._rev) < generation(openRev.rev)) return 'ignored';
  }
  if (doc.content === currentFileContent.peek()) { noteRevSeen(id, doc._rev); return 'ignored'; }
  showNote(id, doc.content, doc._rev);
  return 'adopted';
}

async function doSave(path: string, content: string): Promise<boolean> {
  saveStatus.value = 'saving';
  try {
    // Saves run one after another (chain). A write that never settles — a
    // storage handle gone silent — would otherwise block every later save and
    // every note switch without a word.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let gaveUp = false;
    const write = putNote(path, content, {
      baseRev: () => (openRev?.path === path ? openRev.rev : undefined),
      abandoned: () => gaveUp,
    });
    // A write we stopped waiting for can still land once storage wakes up. Its
    // rev is ours: without adopting it the next save saw "the stored note moved"
    // and kept our own half-typed text as a conflict copy.
    write.then((late) => {
      if (openRev?.path === path && generation(late) > generation(openRev.rev)) openRev.rev = late;
    }, () => undefined);
    const rev = await Promise.race([
      write,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { gaveUp = true; reject(new Error('storage did not respond')); }, saveTimeout);
      }),
    ]).finally(() => clearTimeout(timer));
    updateLinksForFile(path, content);
    indexFile(path, content);
    failStreak = 0;
    retryDelay = retryBase;
    askPersistence();
    if (currentFilePath.peek() === path) {
      if (openRev?.path === path) openRev.rev = rev;
      // `content` is the text as of when this save started. If the user typed
      // during the write the note stays dirty and the effect schedules the next
      // save. The editor never copies savedContent back into the document.
      savedContent.value = content;
      if (!isDirty.peek()) {
        saveStatus.value = 'saved';
        if (statusTimer) clearTimeout(statusTimer);
        statusTimer = setTimeout(() => {
          if (saveStatus.peek() === 'saved') saveStatus.value = 'clean';
        }, 2000);
      } else {
        saveStatus.value = 'dirty';
      }
    }
    return true;
  } catch (e: any) {
    console.error('Save failed:', e);
    // One toast per failure streak — the retry below would otherwise repeat it.
    if (failStreak++ === 0) {
      if (isStorageFull(e) || (isConnectionLost(e) && await deviceStorageFull())) {
        // Emptying the trash does not help here: once the browser is out of space even deletes fail.
        toast.error(STORAGE_FULL_MESSAGE);
      } else {
        toast.error(`Save failed: ${e?.message ?? 'unknown error'} — retrying`);
      }
    }
    // A dead connection never recovers on its own — every retry would fail the
    // same way until a reload. Open a new one; the retry below uses it.
    if (isConnectionLost(e)) {
      try { reopenDB(); } catch (re) { console.error('Reopening storage failed:', re); }
    }
    if (currentFilePath.peek() === path) {
      saveStatus.value = 'dirty';
      scheduleRetry(path);
    }
    return false;
  }
}

// The browser database is the only copy for anyone not syncing, and browsers evict
// non-persistent storage under pressure. Asked once there is something to lose; the answer
// (or a browser that does not ask at all) changes nothing else.
function askPersistence(): void {
  if (persistAsked) return;
  persistAsked = true;
  try { void navigator.storage?.persist?.().catch(() => undefined); } catch { /* not available */ }
}

// Without this a failed save was only retried on the next keystroke; a user who
// stopped typing kept "Unsaved" until they closed the tab.
function scheduleRetry(path: string): void {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, 60_000);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (saveTimer) return; // a debounced save is already on its way
    if (currentFilePath.peek() !== path || !isDirty.peek()) return;
    void saveNote(path, currentFileContent.peek());
  }, delay);
}

/** Save `content` to `path`. Both are passed in — never read from the store at
 *  write time, because by then the editor may be showing a different note. */
export function saveNote(path: string, content: string): Promise<boolean> {
  const run = chain.then(() => doSave(path, content));
  chain = run.catch(() => undefined);
  return run;
}

/** Save unsaved edits right now. Call before the editor switches to another
 *  note or a tab closes. Resolves false if the save failed. */
export async function flushPendingSave(): Promise<boolean> {
  clearTimers();
  dirtySince = null;
  // A save already in flight must land first, or the caller acts on a note
  // that is about to be written again.
  await chain;
  const path = currentFilePath.peek();
  if (!path || !isDirty.peek()) return true;
  return saveNote(path, currentFileContent.peek());
}

/**
 * Flush until the open note is clean. Keystrokes that land while a flush is
 * awaiting belong to the note being left; a single flush drops them when the
 * caller swaps the editor right after. Resolves false if a save failed.
 */
export async function settleOpenNote(): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    if (!(await flushPendingSave())) return false;
    if (!isDirty.peek()) return true;
  }
  return flushPendingSave();
}

/** Debounced auto-save. Returns the disposer. */
export function startAutosave(delay: number = AUTOSAVE_DELAY_MS, retryMs: number = SAVE_RETRY_MS, timeoutMs: number = SAVE_TIMEOUT_MS, maxWaitMs: number = AUTOSAVE_MAX_WAIT_MS): () => void {
  retryBase = retryDelay = retryMs;
  maxWait = maxWaitMs;
  saveTimeout = timeoutMs;
  const dispose = effect(() => {
    const dirty = isDirty.value;
    const path = currentFilePath.value;
    const content = currentFileContent.value;

    clearTimers();
    if (!dirty || !path) {
      dirtySince = null;
      if (saveStatus.peek() === 'dirty') saveStatus.value = 'clean';
      return;
    }
    if (saveStatus.peek() !== 'saving') saveStatus.value = 'dirty';
    const now = Date.now();
    dirtySince ??= now;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      dirtySince = null;
      void saveNote(path, content);
    }, Math.max(0, Math.min(delay, dirtySince + maxWait - now)));
  });
  // A hidden tab may be frozen or discarded without another event (mobile, tab switch, close).
  const flushHidden = () => { if (document.visibilityState === 'hidden') void flushPendingSave(); };
  const flushLeaving = () => { void flushPendingSave(); };
  document.addEventListener('visibilitychange', flushHidden);
  window.addEventListener('pagehide', flushLeaving);
  return () => {
    dispose();
    document.removeEventListener('visibilitychange', flushHidden);
    window.removeEventListener('pagehide', flushLeaving);
    dirtySince = null;
    maxWait = AUTOSAVE_MAX_WAIT_MS;
    clearTimers();
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
    failStreak = 0;
    retryBase = retryDelay = SAVE_RETRY_MS;
    saveTimeout = SAVE_TIMEOUT_MS;
  };
}
