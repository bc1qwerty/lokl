import { signal, computed } from '@preact/signals';
import type { FileEntry, VaultState, ViewMode } from '../types';

// Vault
export const vault = signal<VaultState | null>(null);
export const fileTree = signal<FileEntry[]>([]);
export const isLoading = signal(false);

// Tabs
export const openTabs = signal<string[]>([]);
export const currentFilePath = signal<string | null>(null);
export const currentFileContent = signal('');
export const savedContent = signal('');
export const isDirty = computed(() => currentFileContent.value !== savedContent.value);

// UI state
export const sidebarOpen = signal(true);
export const previewOpen = signal(true);
export const backlinksOpen = signal(true);
export const viewMode = signal<ViewMode>('split');
export const searchOpen = signal(false);
export const quickOpenOpen = signal(false);
export const settingsOpen = signal(false);
export const graphOpen = signal(false);
export const contextMenu = signal<{ x: number; y: number; path: string; kind: string } | null>(null);

// Auth state
export type AuthStatus = 'anonymous' | 'polling' | 'authenticated';
export const authState = signal<{ status: AuthStatus; pubkey?: string; jwt?: string }>({ status: 'anonymous' });

// Sync state
export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error';
export const syncState = signal<{ status: SyncStatus; lastSynced?: Date; error?: string }>({ status: 'offline' });

// Settings
export interface Settings {
  fontSize: number;
  sortBy: 'name' | 'modified';
  editorLineNumbers: boolean;
}
const defaultSettings: Settings = { fontSize: 14, sortBy: 'name', editorLineNumbers: true };
const stored = localStorage.getItem('lokl-settings');
export const settings = signal<Settings>(stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings);

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...settings.value, ...patch };
  settings.value = next;
  localStorage.setItem('lokl-settings', JSON.stringify(next));
}

// Derived
export const currentFileName = computed(() => {
  const p = currentFilePath.value;
  if (!p) return '';
  return p.split('/').pop()?.replace(/\.md$/, '') || '';
});

export const isReadOnly = computed(() => {
  const v = vault.value;
  return v?.mode === 'fallback';
});

// Backlinks: path -> set of paths that link to it
export const backlinksIndex = signal<Map<string, Set<string>>>(new Map());

// Wikilinks: path -> list of link targets
export const wikilinksIndex = signal<Map<string, string[]>>(new Map());

// Tags index: tag -> set of file paths
export const tagsIndex = signal<Map<string, Set<string>>>(new Map());
export const activeTagFilter = signal<string | null>(null);

// All file paths for link resolution
export const allFilePaths = computed(() => {
  const paths: string[] = [];
  function collect(entries: FileEntry[]) {
    for (const e of entries) {
      if (e.kind === 'file') paths.push(e.path);
      if (e.children) collect(e.children);
    }
  }
  collect(fileTree.value);
  return paths;
});

// Tab helpers
export function addTab(path: string) {
  const tabs = openTabs.value;
  if (!tabs.includes(path)) {
    openTabs.value = [...tabs, path];
  }
  currentFilePath.value = path;
}

export function closeTab(path: string) {
  const tabs = openTabs.value.filter((t) => t !== path);
  openTabs.value = tabs;
  if (currentFilePath.value === path) {
    currentFilePath.value = tabs.length > 0 ? tabs[tabs.length - 1] : null;
    if (!currentFilePath.value) {
      currentFileContent.value = '';
      savedContent.value = '';
    }
  }
}
