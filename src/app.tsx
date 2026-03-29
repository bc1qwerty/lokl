import { useSignal, useSignalEffect } from '@preact/signals';
import { useCallback, useEffect } from 'preact/hooks';
import {
  vault,
  fileTree,
  currentFilePath,
  currentFileContent,
  savedContent,
  isDirty,
  sidebarOpen,
  backlinksOpen,
  viewMode,
  searchOpen,
  isLoading,
  isReadOnly,
} from './lib/store';
import { readTree, readFile, writeFile, createFile } from './lib/fs';
import { updateLinksForFile } from './lib/markdown';
import { indexFile, clearIndex } from './lib/search';
import type { VaultState, FileEntry } from './types';

import { WelcomeScreen } from './components/WelcomeScreen';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';
import { BacklinksPanel } from './components/BacklinksPanel';
import { SearchDialog } from './components/SearchDialog';

export function App() {
  const saveStatus = useSignal<'clean' | 'dirty' | 'saving' | 'saved'>('clean');
  const newFileOpen = useSignal(false);
  const newFileName = useSignal('');
  const saveTimerRef = useSignal<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useSignal<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save with debounce
  useSignalEffect(() => {
    const dirty = isDirty.value;
    const ro = isReadOnly.value;
    const v = vault.value;
    const path = currentFilePath.value;

    if (!dirty || ro || !v || !path) {
      if (!dirty) saveStatus.value = 'clean';
      return;
    }

    saveStatus.value = 'dirty';

    if (saveTimerRef.value) clearTimeout(saveTimerRef.value);
    saveTimerRef.value = setTimeout(async () => {
      try {
        saveStatus.value = 'saving';
        await writeFile(v, path, currentFileContent.value);
        savedContent.value = currentFileContent.value;
        updateLinksForFile(path, currentFileContent.value);
        indexFile(path, currentFileContent.value);
        saveStatus.value = 'saved';

        if (statusTimerRef.value) clearTimeout(statusTimerRef.value);
        statusTimerRef.value = setTimeout(() => { saveStatus.value = 'clean'; }, 2000);
      } catch (e) {
        console.error('Save failed:', e);
        saveStatus.value = 'dirty';
      }
    }, 1000);
  });

  // Open vault
  const handleOpenVault = useCallback(async (v: VaultState) => {
    isLoading.value = true;
    vault.value = v;
    try {
      const tree = await readTree(v);
      fileTree.value = tree;

      // Index all files
      clearIndex();
      await indexAllFiles(v, tree);
    } catch (e) {
      console.error('Failed to read vault:', e);
    } finally {
      isLoading.value = false;
    }
  }, []);

  // Index all markdown files
  async function indexAllFiles(v: VaultState, entries: FileEntry[]) {
    for (const entry of entries) {
      if (entry.kind === 'file') {
        try {
          const content = await readFile(v, entry.path);
          indexFile(entry.path, content);
          updateLinksForFile(entry.path, content);
        } catch { /* skip unreadable */ }
      }
      if (entry.children) {
        await indexAllFiles(v, entry.children);
      }
    }
  }

  // Open file
  const handleFileClick = useCallback(async (path: string) => {
    if (!vault.value) return;
    if (path === currentFilePath.value) return;

    try {
      const content = await readFile(vault.value, path);
      savedContent.value = content;
      currentFileContent.value = content;
      currentFilePath.value = path;
      saveStatus.value = 'clean';
    } catch (e) {
      console.error('Failed to read file:', e);
    }
  }, []);

  // Navigate to wiki-link target
  const handleNavigate = useCallback((path: string) => {
    if (path) handleFileClick(path);
  }, [handleFileClick]);

  // New file
  const handleNewFile = useCallback(() => {
    if (isReadOnly.value) return;
    newFileName.value = '';
    newFileOpen.value = true;
  }, []);

  const handleCreateFile = useCallback(async () => {
    const name = newFileName.value.trim();
    if (!name || !vault.value) return;
    const path = name.endsWith('.md') ? name : `${name}.md`;
    try {
      await createFile(vault.value, path);
      const tree = await readTree(vault.value);
      fileTree.value = tree;
      newFileOpen.value = false;
      await handleFileClick(path);
    } catch (e) {
      console.error('Failed to create file:', e);
    }
  }, [handleFileClick]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') {
        e.preventDefault();
        searchOpen.value = !searchOpen.value;
      }
      if (mod && e.key === 'n') {
        e.preventDefault();
        handleNewFile();
      }
      if (mod && e.key === 's') {
        e.preventDefault();
        // Force save
        if (vault.value && currentFilePath.value && isDirty.value && !isReadOnly.value) {
          writeFile(vault.value, currentFilePath.value, currentFileContent.value).then(() => {
            savedContent.value = currentFileContent.value;
            saveStatus.value = 'saved';
          });
        }
      }
      if (mod && e.key === '\\') {
        e.preventDefault();
        sidebarOpen.value = !sidebarOpen.value;
      }
      if (e.key === 'Escape') {
        if (searchOpen.value) searchOpen.value = false;
        if (newFileOpen.value) newFileOpen.value = false;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewFile]);

  // No vault yet → welcome screen
  if (!vault.value) {
    return <WelcomeScreen onOpen={handleOpenVault} />;
  }

  const mode = viewMode.value;

  return (
    <div
      class="app-layout"
      data-sidebar={sidebarOpen.value ? 'open' : 'closed'}
      data-backlinks={backlinksOpen.value ? 'open' : 'closed'}
    >
      <Toolbar saveStatus={saveStatus.value} />

      <Sidebar onFileClick={handleFileClick} onNewFile={handleNewFile} />

      <div class="main-content">
        {(mode === 'edit' || mode === 'split') && <Editor />}
        {(mode === 'preview' || mode === 'split') && (
          <Preview onNavigate={handleNavigate} />
        )}
        {!currentFilePath.value && mode !== 'preview' && (
          <div style="flex:1; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:14px">
            Select a file to start editing
          </div>
        )}
      </div>

      <BacklinksPanel onNavigate={handleNavigate} />

      {searchOpen.value && <SearchDialog onSelect={handleFileClick} />}

      {newFileOpen.value && (
        <div class="new-file-overlay" onClick={(e) => {
          if ((e.target as HTMLElement).classList.contains('new-file-overlay')) {
            newFileOpen.value = false;
          }
        }}>
          <div class="new-file-dialog">
            <h3>New File</h3>
            <input
              class="new-file-input"
              type="text"
              placeholder="filename.md"
              value={newFileName.value}
              onInput={(e) => { newFileName.value = (e.target as HTMLInputElement).value; }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFile();
                if (e.key === 'Escape') { newFileOpen.value = false; }
              }}
              autoFocus
            />
            <div class="new-file-actions">
              <button class="btn-secondary" onClick={() => { newFileOpen.value = false; }}>
                Cancel
              </button>
              <button class="btn-primary" onClick={handleCreateFile}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
