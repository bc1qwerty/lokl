import { effect, signal, batch } from '@preact/signals';
import { currentFilePath, currentFileContent, savedContent, isDirty } from './store';
import { putNote } from './db';
import { updateLinksForFile } from './markdown';
import { indexFile } from './search';
import { toast } from './toast';

export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved';
export const saveStatus = signal<SaveStatus>('clean');

export const AUTOSAVE_DELAY_MS = 1000;

// Plain variables on purpose. These were signals read and written inside the
// autosave effect, which made the effect re-trigger itself every frame and
// re-arm the timer forever — the debounced save never fired.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let statusTimer: ReturnType<typeof setTimeout> | null = null;
// _rev of the note as the editor loaded (or last saved) it — see PutOptions.baseRev.
let openRev: { path: string; rev: string | undefined } | null = null;

/** Put a note into the editor. Batched so the autosave effect never sees a
 *  half-switched state (new path with the previous note's text). */
export function showNote(path: string | null, content: string, rev?: string): void {
  batch(() => {
    savedContent.value = content;
    currentFileContent.value = content;
    currentFilePath.value = path;
  });
  openRev = path ? { path, rev } : null;
}

/** Record the stored _rev of the open note (after the change feed refreshed it). */
export function noteRevSeen(path: string, rev: string | undefined): void {
  if (openRev?.path === path) openRev.rev = rev;
}

/** Save `content` to `path`. Both are passed in — never read from the store at
 *  write time, because by then the editor may be showing a different note. */
export async function saveNote(path: string, content: string): Promise<boolean> {
  saveStatus.value = 'saving';
  try {
    const rev = await putNote(path, content, {
      baseRev: openRev?.path === path ? openRev.rev : undefined,
    });
    updateLinksForFile(path, content);
    indexFile(path, content);
    if (currentFilePath.peek() === path) {
      if (openRev?.path === path) openRev.rev = rev;
      // If the user typed during the write this leaves the note dirty and the
      // effect schedules the next save.
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
    if (e?.name === 'QuotaExceededError' || e?.status === 507) {
      toast.error('Storage full — empty trash to free space');
    } else {
      toast.error(`Save failed: ${e?.message ?? 'unknown error'}`);
    }
    if (currentFilePath.peek() === path) saveStatus.value = 'dirty';
    return false;
  }
}

/** Save unsaved edits right now. Call before the editor switches to another
 *  note or a tab closes. Resolves false if the save failed. */
export async function flushPendingSave(): Promise<boolean> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const path = currentFilePath.peek();
  if (!path || !isDirty.peek()) return true;
  return saveNote(path, currentFileContent.peek());
}

/** Debounced auto-save. Returns the disposer. */
export function startAutosave(delay: number = AUTOSAVE_DELAY_MS): () => void {
  const dispose = effect(() => {
    const dirty = isDirty.value;
    const path = currentFilePath.value;
    const content = currentFileContent.value;

    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!dirty || !path) {
      if (saveStatus.peek() === 'dirty') saveStatus.value = 'clean';
      return;
    }
    if (saveStatus.peek() !== 'saving') saveStatus.value = 'dirty';
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveNote(path, content);
    }, delay);
  });
  return () => {
    dispose();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  };
}
