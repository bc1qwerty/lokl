import { putNote, listNotes } from './db';

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
    const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(note.content);
    await writable.close();
    exported++;
    onProgress?.(exported, notes.length);
  }

  return exported;
}
