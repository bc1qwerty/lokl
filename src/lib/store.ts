import { signal, computed } from '@preact/signals';
import type { ActiveVault, FileEntry, ViewMode } from '../types';

// Vault
export const vault = signal<ActiveVault | null>(null);
export const fileTree = signal<FileEntry[]>([]);
export const isLoading = signal(false);

// Tabs
export const openTabs = signal<string[]>([]);
export const currentFilePath = signal<string | null>(null);
export const currentFileContent = signal('');
export const savedContent = signal('');
export const isDirty = computed(() => currentFileContent.value !== savedContent.value);

// UI state
/** Phone-sized window: the side panels are drawers over the editor (see layout.css). */
export function isNarrow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 720px)').matches;
}
// On a narrow window both panels open would cover the note entirely, and a split view is two slivers.
export const sidebarOpen = signal(!isNarrow());
export const previewOpen = signal(true);
export const backlinksOpen = signal(!isNarrow());
export const viewMode = signal<ViewMode>(isNarrow() ? 'edit' : 'split');
// On a narrow window the two drawers share the same space: opening one closes the other, or the
// one underneath is left open but covered.
export function toggleSidebar(): void {
  sidebarOpen.value = !sidebarOpen.value;
  if (sidebarOpen.value && isNarrow()) backlinksOpen.value = false;
}
export function toggleBacklinks(): void {
  backlinksOpen.value = !backlinksOpen.value;
  if (backlinksOpen.value && isNarrow()) sidebarOpen.value = false;
}

// Crossing the breakpoint later (rotating a phone, resizing a window): drawers start closed again,
// the desktop layout gets its side panels back.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(max-width: 720px)').addEventListener?.('change', (e) => {
    sidebarOpen.value = !e.matches;
    backlinksOpen.value = !e.matches;
  });
}
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
function loadSettings(): Settings {
  // A corrupt value must not take the whole app down at module load.
  try {
    const stored = localStorage.getItem('lokl-settings');
    const parsed = stored ? JSON.parse(stored) : null;
    return parsed && typeof parsed === 'object' ? { ...defaultSettings, ...parsed } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}
export const settings = signal<Settings>(loadSettings());

export function updateSettings(patch: Partial<Settings>) {
  const next = { ...settings.value, ...patch };
  settings.value = next;
  localStorage.setItem('lokl-settings', JSON.stringify(next));
}

/** The tree in the order chosen in Settings ("Sort files by"). Directories stay first. */
export function sortTree(entries: FileEntry[], by: Settings['sortBy']): FileEntry[] {
  const newest = (e: FileEntry): string =>
    e.kind === 'file' ? (e.modified ?? '') : (e.children ?? []).reduce((m, c) => { const v = newest(c); return v > m ? v : m; }, '');
  const out = entries.map((e) => (e.children ? { ...e, children: sortTree(e.children, by) } : e));
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    if (by === 'modified') {
      const d = newest(b).localeCompare(newest(a));
      if (d !== 0) return d;
    }
    return a.name.localeCompare(b.name);
  });
  return out;
}

// Derived
export const currentFileName = computed(() => {
  const p = currentFilePath.value;
  if (!p) return '';
  return p.split('/').pop()?.replace(/\.md$/, '') || '';
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
