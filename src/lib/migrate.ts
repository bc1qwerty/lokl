import { putNote, listNotes } from './db';
import { safeNoteId } from './note-path';

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
  /** Files that could not be stored, with the reason — never dropped silently. */
  skipped: Array<{ path: string; reason: string }>;
  /** Files stored under another id because the original one cannot be a note id. */
  renamed: Array<{ from: string; to: string }>;
}

// Import all .md files from a FSAA directory into PouchDB.
// One bad file must not end the import: it used to throw out of the loop on the
// first "_index.md" (PouchDB refuses ids starting with "_"), leaving a partial
// vault that looked complete.
export async function importFromFSAA(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (current: number, total: number) => void
): Promise<ImportReport> {
  const files = await collectFiles(dirHandle);
  const report: ImportReport = { imported: 0, skipped: [], renamed: [] };
  const taken = new Set(files.map((f) => f.path));
  let done = 0;

  for (const { path, handle } of files) {
    try {
      const id = safeNoteId(path);
      if (id !== path) {
        // The swapped name may already belong to another file of this folder.
        if (taken.has(id)) throw new Error(`"${id}" already exists`);
        taken.add(id);
      }
      const file = await handle.getFile();
      const content = await file.text();
      await putNote(id, content);
      if (id !== path) report.renamed.push({ from: path, to: id });
      report.imported++;
    } catch (e: any) {
      report.skipped.push({ path, reason: e?.message ?? String(e) });
    }
    onProgress?.(++done, files.length);
  }

  return report;
}

/** One line for the UI: "Imported 7 files. Renamed 2 (_a.md → -a.md, …). Skipped 1 (x.md)." */
export function describeImport(r: ImportReport): string {
  const list = (items: string[]) => items.slice(0, 5).join(', ') + (items.length > 5 ? `, +${items.length - 5} more` : '');
  let msg = `Imported ${r.imported} file${r.imported === 1 ? '' : 's'}.`;
  if (r.renamed.length) msg += ` Renamed ${r.renamed.length} (names can't start with "_"): ${list(r.renamed.map((x) => `${x.from} → ${x.to}`))}.`;
  if (r.skipped.length) msg += ` Skipped ${r.skipped.length}: ${list(r.skipped.map((x) => `${x.path} (${x.reason})`))}.`;
  return msg;
}

async function collectFiles(
  dirHandle: FileSystemDirectoryHandle,
  prefix = ''
): Promise<Array<{ path: string; handle: FileSystemFileHandle }>> {
  const result: Array<{ path: string; handle: FileSystemFileHandle }> = [];

  for await (const entry of (dirHandle as any).values()) {
    const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file' && entry.name.endsWith('.md') && !entry.name.startsWith('.')) {
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
