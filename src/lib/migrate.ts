import { putNote, listNotes, getDB } from './db';
import type { NoteDoc } from './db';
import { safeNoteId } from './note-path';
import { toast, dismiss } from './toast';

const TMP_SUFFIX = '.lokl-tmp';

async function atomicWrite(
  dir: FileSystemDirectoryHandle,
  name: string,
  content: string,
): Promise<void> {
  const tmpName = `${name}${TMP_SUFFIX}`;
  // Create + write temp file
  const tmpHandle = await dir.getFileHandle(tmpName, { create: true });
  const w = await tmpHandle.createWritable();
  try {
    await w.write(content);
    await w.close();
  } catch (e) {
    // Best-effort cleanup of the half-written temp file
    try { await dir.removeEntry(tmpName); } catch { /* ignore */ }
    throw e;
  }
  // Promote temp to final
  if (typeof (tmpHandle as any).move === 'function') {
    await (tmpHandle as any).move(name);
    return;
  }
  // Fallback: re-read tmp, write to final, then remove tmp
  const data = await (await tmpHandle.getFile()).text();
  const finalHandle = await dir.getFileHandle(name, { create: true });
  const fw = await finalHandle.createWritable();
  try {
    await fw.write(data);
    await fw.close();
  } catch (e) {
    try { await dir.removeEntry(tmpName); } catch { /* ignore */ }
    throw e;
  }
  await dir.removeEntry(tmpName);
}

export function needsMigration(): boolean {
  return !localStorage.getItem('lokl_storage_migrated');
}

export function markMigrated(): void {
  localStorage.setItem('lokl_storage_migrated', '1');
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
  return safeNoteId(path.replace(MARKDOWN_EXT, '.md'));
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
  for (const row of (await getDB().allDocs({ include_docs: true })).rows) {
    const d = row.doc as NoteDoc | undefined;
    if (d?.conflictOf) alreadyKept.add(`${d.conflictOf}\u0000${d.content}`);
  }
  let done = 0;

  const guarded = typeof window !== 'undefined';
  if (guarded && importsRunning++ === 0) window.addEventListener('beforeunload', warnBeforeUnload);
  markProgress({ done: 0, total: files.length });
  try {
    for (const { path, handle } of files) {
      try {
        const id = noteIdFor(path);
        if (id !== path) {
          // The swapped name may already belong to another file of this folder.
          if (taken.has(id)) throw new Error(`"${id}" already exists`);
          taken.add(id);
        }
        const file = await handle.getFile();
        const content = await file.text();
        const existing = await rawGet(id);
        if (!existing || existing.trashed || existing.deleted) {
          // (a trashed note of that name is parked by putNote, not lost)
          await putNote(id, content);
          report.imported++;
          if (id !== path) report.renamed.push({ from: path, to: id });
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
        report.skipped.push({ path, reason: e?.message ?? String(e) });
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

// cyrb53 — a short, stable, non-cryptographic hash; only has to tell texts apart within one note's copies.
function contentHash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

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
  const list = (items: string[]) => items.slice(0, 5).join(', ') + (items.length > 5 ? `, +${items.length - 5} more` : '');
  let msg = `Imported ${r.imported} file${r.imported === 1 ? '' : 's'}.`;
  if (r.unchanged) msg += ` ${r.unchanged} already in the vault.`;
  if (r.conflicts.length) msg += ` ${r.conflicts.length} differ from a note already here — kept as conflict copies: ${list(r.conflicts.map((x) => x.path))}.`;
  if (r.renamed.length) msg += ` Renamed ${r.renamed.length} (ids end in ".md" and can't start with "_"): ${list(r.renamed.map((x) => `${x.from} → ${x.to}`))}.`;
  if (r.skipped.length) msg += ` Skipped ${r.skipped.length}: ${list(r.skipped.map((x) => `${x.path} (${x.reason})`))}.`;
  return msg;
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

// Export all notes from PouchDB to FSAA directory
export async function exportToFSAA(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (current: number, total: number) => void
): Promise<number> {
  const notes = await listNotes();
  let exported = 0;

  for (const note of notes) {
    const parts = note._id.split('/');
    let currentDir = dirHandle;

    // Create subdirectories
    for (let i = 0; i < parts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(parts[i], { create: true });
    }

    const fileName = parts[parts.length - 1];
    await atomicWrite(currentDir, fileName, note.content);
    exported++;
    onProgress?.(exported, notes.length);
  }

  return exported;
}
