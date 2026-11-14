import { putNote, listNotes, getDB } from './db';
import type { NoteDoc } from './db';
import { safeNoteId, contentHash, nfc } from './note-path';
import { toast, dismiss } from './toast';
import { t, tf } from '../i18n';
import { appError, errorText } from './error-text';

export function isNativeSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

export interface ImportReport {
  imported: number;
  /** Already in the vault with the same text — nothing to do (a re-run after an interrupted import). */
  unchanged: number;
  /** A note of that name already exists with different text: the vault's note stays, the file is kept as a conflict copy. */
  conflicts: Array<{ path: string; keptAs: string }>;
  /** Files that could not be stored, with the reason — never dropped silently. */
  skipped: Array<{ path: string; reason: string }>;
  /** Files stored under another id because the original one cannot be a note id. */
  renamed: Array<{ from: string; to: string }>;
}

// An import that never finished (tab closed, reload, crash) used to leave a
// partial vault that opened as if complete. The marker survives the page; the
// app reports it on the next start (see takeInterruptedImport).
const PROGRESS_KEY = 'lokl_import_progress';

export interface ImportProgress { done: number; total: number }

function markProgress(p: ImportProgress | null): void {
  try {
    if (p) localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
    else localStorage.removeItem(PROGRESS_KEY);
  } catch { /* private mode: the import itself still works */ }
}

// Held for as long as an import is writing; released by the browser when its
// page goes away. Lets another tab tell "still running over there" from "cut short".
const IMPORT_LOCK = 'lokl-folder-import';
type LockManagerLike = {
  request<T>(name: string, fn: () => Promise<T>): Promise<T>;
  query(): Promise<{ held?: Array<{ name?: string }> }>;
};
const lockManager = (): LockManagerLike | undefined =>
  (typeof navigator !== 'undefined' ? (navigator as unknown as { locks?: LockManagerLike }).locks : undefined);

/** The import a previous page left unfinished, if any (not one that is still running in another tab). */
export async function interruptedImport(): Promise<ImportProgress | null> {
  let found: ImportProgress | null = null;
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    const p = raw ? JSON.parse(raw) : null;
    if (typeof p?.done === 'number' && typeof p?.total === 'number') found = { done: p.done, total: p.total };
  } catch { /* unreadable marker: nothing to report */ }
  if (!found) return null;
  try {
    const state = await lockManager()?.query();
    if (state?.held?.some((l) => l.name === IMPORT_LOCK)) return null;
  } catch { /* no lock information: report what the marker says */ }
  return found;
}

export function clearInterruptedImport(): void {
  markProgress(null);
}

// The "import was interrupted" reminder shown at startup. Once an import runs to the
// end the reminder is stale, so it is taken down instead of lingering for its two minutes.
let interruptedToast: string | null = null;
export function rememberInterruptedToast(id: string): void {
  interruptedToast = id;
}

let importsRunning = 0;
/** True while a folder import is writing — the page should not be closed. */
export function importRunning(): boolean {
  return importsRunning > 0;
}
function warnBeforeUnload(e: BeforeUnloadEvent) {
  e.preventDefault();
  e.returnValue = '';
}

/** "README.MD" / "notes.markdown" → the ".md" id the rest of the app expects. */
const MARKDOWN_EXT = /\.(md|markdown)$/i;
function noteIdFor(path: string): string {
  return safeNoteId(nfc(path).replace(MARKDOWN_EXT, '.md'));
}

// Import all markdown files from a FSAA directory into PouchDB.
// - One bad file must not end the import: it used to throw out of the loop on the
//   first "_index.md" (PouchDB refuses ids starting with "_"), leaving a partial
//   vault that looked complete.
// - A note that already exists is never overwritten: same text → left alone,
//   different text → the file is kept beside it as a conflict copy. That makes
//   running the import again (after an interruption, or into a vault another tab
//   created meanwhile) safe.
export function importFromFSAA(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (current: number, total: number) => void
): Promise<ImportReport> {
  const locks = lockManager();
  const run = () => importFiles(dirHandle, onProgress);
  return locks ? locks.request(IMPORT_LOCK, run) : run();
}

async function importFiles(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (current: number, total: number) => void
): Promise<ImportReport> {
  const files = await collectFiles(dirHandle);
  const report: ImportReport = { imported: 0, unchanged: 0, conflicts: [], skipped: [], renamed: [] };
  const taken = new Set(files.map((f) => f.path));
  // Conflict copies an earlier run already left behind (so a re-run does not add them again).
  const alreadyKept = new Set<string>();
  // Notes an earlier version imported from a Mac folder keep their decomposed (NFD) ids. Looked up
  // by the composed id alone they read as "not there", and running the import again — the way to
  // finish an interrupted one — made a second copy of every note.
  const byNfc = new Map<string, string>();
  for (const row of (await getDB().allDocs({ include_docs: true })).rows) {
    const d = row.doc as NoteDoc | undefined;
    if (d?.conflictOf) alreadyKept.add(`${d.conflictOf}\u0000${d.content}`);
    const n = nfc(row.id);
    // both spellings present: the composed one is the id a new import would write
    if (row.id === n || !byNfc.has(n)) byNfc.set(n, row.id);
  }
  let done = 0;

  const guarded = typeof window !== 'undefined';
  if (guarded && importsRunning++ === 0) window.addEventListener('beforeunload', warnBeforeUnload);
  markProgress({ done: 0, total: files.length });
  try {
    for (const { path, handle } of files) {
      try {
        const composed = noteIdFor(path);
        const id = byNfc.get(composed) ?? composed;
        if (id !== path) {
          // The swapped name may already belong to another file of this folder.
          if (taken.has(id)) throw appError('NAME_TAKEN', `"${id}" already exists`, id);
          taken.add(id);
        }
        const file = await handle.getFile();
        const content = await file.text();
        const existing = await rawGet(id);
        if (!existing || existing.trashed || existing.deleted) {
          // (a trashed note of that name is parked by putNote, not lost)
          await putNote(id, content);
          report.imported++;
          if (nfc(id) !== nfc(path)) report.renamed.push({ from: path, to: id });
        } else if (existing.content === content || alreadyKept.has(`${id}\u0000${content}`)) {
          report.unchanged++;
        } else {
          // The copy's id and fields come from the text alone, so two devices importing the same
          // folder write the very same document (same id, same revision) instead of one copy each.
          const keptAs = `${id.replace(/\.md$/, '')} (conflict-import-${contentHash(content)}).md`;
          const kept = await rawGet(keptAs);
          if (kept) {
            // Already kept by an earlier run or another device — or since edited or binned by
            // the user. Either way it is theirs now; never write over it.
            report.unchanged++;
          } else {
            await getDB().put({
              _id: keptAs, content, conflictOf: id,
              title: path.split('/').pop()!.replace(MARKDOWN_EXT, ''), tags: [], links: [],
              createdAt: IMPORT_COPY_STAMP, updatedAt: IMPORT_COPY_STAMP,
            });
            report.conflicts.push({ path, keptAs });
          }
          alreadyKept.add(`${id}\u0000${content}`);
        }
      } catch (e: any) {
        report.skipped.push({ path, reason: errorText(e) });
      }
      done++;
      if (done % 20 === 0) markProgress({ done, total: files.length });
      onProgress?.(done, files.length);
    }
    // Ran to the end: nothing was interrupted (skipped files are in the report).
    markProgress(null);
    if (interruptedToast) { dismiss(interruptedToast); interruptedToast = null; }
  } finally {
    if (guarded && --importsRunning === 0) window.removeEventListener('beforeunload', warnBeforeUnload);
  }

  return report;
}

// Fixed so the copy is byte-identical wherever it is written (see above).
const IMPORT_COPY_STAMP = '1970-01-01T00:00:00.000Z';


async function rawGet(id: string): Promise<NoteDoc | null> {
  try {
    return await getDB().get(id);
  } catch (e: any) {
    if (e?.status === 404) return null;
    throw e;
  }
}

/** One line for the UI: "Imported 7 files. Renamed 2 (_a.md → -a.md, …). Skipped 1 (x.md)." */
export function describeImport(r: ImportReport): string {
  const m = t.value.msg;
  const list = (items: string[]) => items.slice(0, 5).join(', ') + (items.length > 5 ? `, ${tf(m.andMore, { n: items.length - 5 })}` : '');
  const parts = [r.imported === 1 ? m.importedOne : tf(m.importedMany, { n: r.imported })];
  if (r.unchanged) parts.push(tf(m.alreadyInVault, { n: r.unchanged }));
  if (r.conflicts.length) parts.push(tf(m.conflictsKept, { n: r.conflicts.length, list: list(r.conflicts.map((x) => x.path)) }));
  if (r.renamed.length) parts.push(tf(m.renamedList, { n: r.renamed.length, list: list(r.renamed.map((x) => `${x.from} → ${x.to}`)) }));
  if (r.skipped.length) parts.push(tf(m.skippedList, { n: r.skipped.length, list: list(r.skipped.map((x) => `${x.path} (${x.reason})`)) }));
  return parts.join(' ');
}

/** Show the outcome — always: a partial import used to look complete. */
export function announceImport(report: ImportReport): void {
  const summary = describeImport(report);
  if (report.skipped.length) toast.error(summary);
  else if (report.renamed.length || report.conflicts.length) toast.warning(summary, { ttl: 20000 });
  else toast.success(summary);
}

async function collectFiles(
  dirHandle: FileSystemDirectoryHandle,
  prefix = ''
): Promise<Array<{ path: string; handle: FileSystemFileHandle }>> {
  const result: Array<{ path: string; handle: FileSystemFileHandle }> = [];

  for await (const entry of (dirHandle as any).values()) {
    const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file' && MARKDOWN_EXT.test(entry.name) && !entry.name.startsWith('.')) {
      result.push({ path: entryPath, handle: entry as FileSystemFileHandle });
    } else if (entry.kind === 'directory' && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      const sub = await collectFiles(entry as FileSystemDirectoryHandle, entryPath);
      result.push(...sub);
    }
  }

  return result;
}
