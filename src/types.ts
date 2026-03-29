export interface FileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  children?: FileEntry[];
}

export interface SearchResult {
  id: string;
  title: string;
  path: string;
  score: number;
  match: Record<string, string[]>;
}

export type ViewMode = 'edit' | 'split' | 'preview';

export type VaultMode = 'native' | 'fallback';

export interface VaultState {
  mode: VaultMode;
  name: string;
  handle?: FileSystemDirectoryHandle;
  files?: Map<string, File>;
}

// File System Access API type augmentations
declare global {
  interface FileSystemHandle {
    queryPermission(desc?: { mode?: string }): Promise<string>;
    requestPermission(desc?: { mode?: string }): Promise<string>;
  }
  interface Window {
    showDirectoryPicker(options?: { mode?: string }): Promise<FileSystemDirectoryHandle>;
  }
}
