import type { FileEntry, VaultState } from '../types';

const DB_NAME = 'lokl';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const HANDLE_KEY = 'vault';

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function restoreHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function checkPermission(
  handle: FileSystemDirectoryHandle,
  mode = 'readwrite'
): Promise<boolean> {
  const perm = await (handle as any).queryPermission({ mode });
  if (perm === 'granted') return true;
  const req = await (handle as any).requestPermission({ mode });
  return req === 'granted';
}

// --- Feature detection ---

export function isNativeSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

// --- Open directory ---

export async function openNativeDirectory(): Promise<VaultState> {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await persistHandle(handle);
  return { mode: 'native', name: handle.name, handle };
}

export async function openFallbackDirectory(): Promise<VaultState> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('multiple', '');
    input.onchange = () => {
      const fileList = input.files;
      if (!fileList || fileList.length === 0) {
        reject(new Error('No files selected'));
        return;
      }
      const files = new Map<string, File>();
      let vaultName = '';
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const relPath = file.webkitRelativePath;
        if (!vaultName) {
          vaultName = relPath.split('/')[0];
        }
        // Store path without the root folder name
        const path = relPath.substring(vaultName.length + 1);
        if (path && file.name.endsWith('.md')) {
          files.set(path, file);
        }
      }
      resolve({ mode: 'fallback', name: vaultName, files });
    };
    input.oncancel = () => reject(new Error('Cancelled'));
    input.click();
  });
}

export async function openDirectory(): Promise<VaultState> {
  if (isNativeSupported()) {
    return openNativeDirectory();
  }
  return openFallbackDirectory();
}

export async function reopenDirectory(): Promise<VaultState | null> {
  if (!isNativeSupported()) return null;
  const handle = await restoreHandle();
  if (!handle) return null;
  const granted = await checkPermission(handle);
  if (!granted) return null;
  return { mode: 'native', name: handle.name, handle };
}

// --- Read directory tree ---

async function readNativeTree(
  dirHandle: FileSystemDirectoryHandle,
  prefix = ''
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  for await (const [name, entry] of dirHandle.entries()) {
    if (name.startsWith('.')) continue; // skip hidden
    const path = prefix ? `${prefix}/${name}` : name;
    if (entry.kind === 'directory') {
      const children = await readNativeTree(
        entry as FileSystemDirectoryHandle,
        path
      );
      entries.push({ name, path, kind: 'directory', children });
    } else if (name.endsWith('.md')) {
      entries.push({ name, path, kind: 'file' });
    }
  }
  return sortEntries(entries);
}

function readFallbackTree(files: Map<string, File>): FileEntry[] {
  const root: FileEntry[] = [];
  const dirs = new Map<string, FileEntry>();

  for (const path of files.keys()) {
    const parts = path.split('/');
    let current = root;
    let currentPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      if (!dirs.has(currentPath)) {
        const dir: FileEntry = {
          name: parts[i],
          path: currentPath,
          kind: 'directory',
          children: [],
        };
        dirs.set(currentPath, dir);
        current.push(dir);
      }
      current = dirs.get(currentPath)!.children!;
    }

    current.push({
      name: parts[parts.length - 1],
      path,
      kind: 'file',
    });
  }

  return sortEntries(root);
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readTree(vault: VaultState): Promise<FileEntry[]> {
  if (vault.mode === 'native' && vault.handle) {
    return readNativeTree(vault.handle);
  }
  if (vault.mode === 'fallback' && vault.files) {
    return readFallbackTree(vault.files);
  }
  return [];
}

// --- Read / Write files ---

async function resolveFileHandle(
  dirHandle: FileSystemDirectoryHandle,
  path: string
): Promise<FileSystemFileHandle> {
  const parts = path.split('/');
  let current = dirHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i]);
  }
  return current.getFileHandle(parts[parts.length - 1]);
}

export async function readFile(vault: VaultState, path: string): Promise<string> {
  if (vault.mode === 'native' && vault.handle) {
    const fh = await resolveFileHandle(vault.handle, path);
    const file = await fh.getFile();
    return file.text();
  }
  if (vault.mode === 'fallback' && vault.files) {
    const file = vault.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return file.text();
  }
  throw new Error('No vault open');
}

export async function writeFile(
  vault: VaultState,
  path: string,
  content: string
): Promise<void> {
  if (vault.mode !== 'native' || !vault.handle) {
    throw new Error('Write not supported in fallback mode');
  }
  const fh = await resolveFileHandle(vault.handle, path);
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function createFile(
  vault: VaultState,
  path: string
): Promise<void> {
  if (vault.mode !== 'native' || !vault.handle) {
    throw new Error('Create not supported in fallback mode');
  }
  const parts = path.split('/');
  let current = vault.handle;
  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i], { create: true });
  }
  await current.getFileHandle(parts[parts.length - 1], { create: true });
}

export async function deleteFile(
  vault: VaultState,
  path: string
): Promise<void> {
  if (vault.mode !== 'native' || !vault.handle) {
    throw new Error('Delete not supported in fallback mode');
  }
  const parts = path.split('/');
  let current = vault.handle;
  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i]);
  }
  await current.removeEntry(parts[parts.length - 1]);
}
