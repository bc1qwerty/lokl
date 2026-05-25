import { putNote, listNotes } from './db';

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

// Import all .md files from a FSAA directory into PouchDB
export async function importFromFSAA(
  dirHandle: FileSystemDirectoryHandle,
  onProgress?: (current: number, total: number) => void
): Promise<number> {
  const files = await collectFiles(dirHandle);
  let imported = 0;

  for (const { path, handle } of files) {
    const file = await handle.getFile();
    const content = await file.text();
    await putNote(path, content);
    imported++;
    onProgress?.(imported, files.length);
  }

  return imported;
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
