import { useSignal, useSignalEffect } from '@preact/signals';
import { useCallback, useEffect, useRef } from 'preact/hooks';
import {
  vault, fileTree, currentFilePath, currentFileContent, savedContent,
  isDirty, sidebarOpen, backlinksOpen, viewMode, searchOpen,
  quickOpenOpen, settingsOpen, graphOpen, contextMenu,
  isLoading, isReadOnly, addTab, openTabs, settings,
} from './lib/store';
import { readTree, readFile, writeFile, createFile, deleteFile } from './lib/fs';
import { updateLinksForFile } from './lib/markdown';
import { indexFile, clearIndex, removeFromIndex } from './lib/search';
import type { VaultState, FileEntry } from './types';

import { WelcomeScreen } from './components/WelcomeScreen';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';
import { BacklinksPanel } from './components/BacklinksPanel';
import { TagsPanel } from './components/TagsPanel';
import { SearchDialog } from './components/SearchDialog';
import { QuickOpen } from './components/QuickOpen';
import { ContextMenu } from './components/ContextMenu';
import { GraphView } from './components/GraphView';
import { SettingsPanel } from './components/SettingsPanel';

export function App() {
  const saveStatus = useSignal<'clean' | 'dirty' | 'saving' | 'saved'>('clean');
  const newFileOpen = useSignal(false);
  const newFileName = useSignal('');
  const renameOpen = useSignal(false);
  const renameTarget = useSignal('');
  const renameValue = useSignal('');
  const saveTimerRef = useSignal<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useSignal<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // External change detection (poll every 3s)
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      const v = vault.value;
      const path = currentFilePath.value;
      if (!v || !path || v.mode !== 'native' || isDirty.value) return;
      try {
        const content = await readFile(v, path);
        if (content !== savedContent.value) {
          savedContent.value = content;
          currentFileContent.value = content;
        }
      } catch { /* file may have been deleted */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Open vault
  const handleOpenVault = useCallback(async (v: VaultState) => {
    isLoading.value = true;
    vault.value = v;
    try {
      const tree = await readTree(v);
      fileTree.value = tree;
      clearIndex();
      await indexAllFiles(v, tree);
    } catch (e) {
      console.error('Failed to read vault:', e);
    } finally {
      isLoading.value = false;
    }
  }, []);

  async function indexAllFiles(v: VaultState, entries: FileEntry[]) {
    for (const entry of entries) {
      if (entry.kind === 'file') {
        try {
          const content = await readFile(v, entry.path);
          indexFile(entry.path, content);
          updateLinksForFile(entry.path, content);
        } catch { /* skip */ }
      }
      if (entry.children) await indexAllFiles(v, entry.children);
    }
  }

  // Open file (with tab)
  const handleFileClick = useCallback(async (path: string) => {
    if (!vault.value) return;
    try {
      const content = await readFile(vault.value, path);
      savedContent.value = content;
      currentFileContent.value = content;
      currentFilePath.value = path;
      addTab(path);
      saveStatus.value = 'clean';
    } catch (e) {
      console.error('Failed to read file:', e);
    }
  }, []);

  // Tab click (switch to already loaded file)
  const handleTabClick = useCallback(async (path: string) => {
    if (path === currentFilePath.value) return;
    await handleFileClick(path);
  }, [handleFileClick]);

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

  // Daily note
  const handleDailyNote = useCallback(async () => {
    if (!vault.value || isReadOnly.value) return;
    const today = new Date().toISOString().slice(0, 10);
    const path = `${today}.md`;
    try {
      await readFile(vault.value, path);
      await handleFileClick(path);
    } catch {
      await createFile(vault.value, path);
      await writeFile(vault.value, path, `# ${today}\n\n`);
      const tree = await readTree(vault.value);
      fileTree.value = tree;
      indexFile(path, `# ${today}\n\n`);
      await handleFileClick(path);
    }
  }, [handleFileClick]);

  // Context menu actions
  const handleRename = useCallback(async (path: string) => {
    renameTarget.value = path;
    renameValue.value = path.split('/').pop()?.replace(/\.md$/, '') || '';
    renameOpen.value = true;
  }, []);

  const handleDoRename = useCallback(async () => {
    const oldPath = renameTarget.value;
    let newName = renameValue.value.trim();
    if (!newName || !vault.value) return;
    if (!newName.endsWith('.md')) newName += '.md';
    const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/') + 1) : '';
    const newPath = dir + newName;
    try {
      const content = await readFile(vault.value, oldPath);
      await createFile(vault.value, newPath);
      await writeFile(vault.value, newPath, content);
      await deleteFile(vault.value, oldPath);
      removeFromIndex(oldPath);
      indexFile(newPath, content);
      const tree = await readTree(vault.value);
      fileTree.value = tree;
      renameOpen.value = false;
      if (currentFilePath.value === oldPath) await handleFileClick(newPath);
    } catch (e) {
      console.error('Rename failed:', e);
    }
  }, [handleFileClick]);

  const handleDelete = useCallback(async (path: string) => {
    if (!vault.value || !confirm(`Delete "${path.split('/').pop()}"?`)) return;
    try {
      await deleteFile(vault.value, path);
      removeFromIndex(path);
      const { closeTab } = await import('./lib/store');
      closeTab(path);
      const tree = await readTree(vault.value);
      fileTree.value = tree;
    } catch (e) {
      console.error('Delete failed:', e);
    }
  }, []);

  const handleDuplicate = useCallback(async (path: string) => {
    if (!vault.value) return;
    const name = path.split('/').pop()?.replace(/\.md$/, '') || 'untitled';
    const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/') + 1) : '';
    const newPath = `${dir}${name} copy.md`;
    try {
      const content = await readFile(vault.value, path);
      await createFile(vault.value, newPath);
      await writeFile(vault.value, newPath, content);
      indexFile(newPath, content);
      const tree = await readTree(vault.value);
      fileTree.value = tree;
      await handleFileClick(newPath);
    } catch (e) {
      console.error('Duplicate failed:', e);
    }
  }, [handleFileClick]);

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).catch(() => {});
  }, []);

  const handleNewFileHere = useCallback((dirPath: string) => {
    newFileName.value = dirPath + '/';
    newFileOpen.value = true;
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') { e.preventDefault(); searchOpen.value = !searchOpen.value; }
      if (mod && e.key === 'p') { e.preventDefault(); quickOpenOpen.value = !quickOpenOpen.value; }
      if (mod && e.key === 'n') { e.preventDefault(); handleNewFile(); }
      if (mod && e.key === 's') {
        e.preventDefault();
        if (vault.value && currentFilePath.value && isDirty.value && !isReadOnly.value) {
          writeFile(vault.value, currentFilePath.value, currentFileContent.value).then(() => {
            savedContent.value = currentFileContent.value;
            saveStatus.value = 'saved';
          });
        }
      }
      if (mod && e.key === '\\') { e.preventDefault(); sidebarOpen.value = !sidebarOpen.value; }
      // Font size: Cmd+= / Cmd+-
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        const s = settings.value;
        if (s.fontSize < 24) settings.value = { ...s, fontSize: s.fontSize + 1 };
        localStorage.setItem('lokl-settings', JSON.stringify(settings.value));
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        const s = settings.value;
        if (s.fontSize > 10) settings.value = { ...s, fontSize: s.fontSize - 1 };
        localStorage.setItem('lokl-settings', JSON.stringify(settings.value));
      }
      if (e.key === 'Escape') {
        if (searchOpen.value) searchOpen.value = false;
        else if (quickOpenOpen.value) quickOpenOpen.value = false;
        else if (newFileOpen.value) newFileOpen.value = false;
        else if (renameOpen.value) renameOpen.value = false;
        else if (settingsOpen.value) settingsOpen.value = false;
        else if (graphOpen.value) graphOpen.value = false;
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNewFile]);

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
      <Toolbar saveStatus={saveStatus.value} onDailyNote={handleDailyNote} />

      <Sidebar onFileClick={handleFileClick} onNewFile={handleNewFile} />

      <div class="main-content">
        <div style="display:flex; flex-direction:column; flex:1; min-width:0; overflow:hidden">
          <TabBar onTabClick={handleTabClick} />
          <div style="display:flex; flex:1; overflow:hidden">
            {(mode === 'edit' || mode === 'split') && <Editor />}
            {(mode === 'preview' || mode === 'split') && <Preview onNavigate={handleNavigate} />}
            {!currentFilePath.value && (
              <div style="flex:1; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:14px">
                Select a file to start editing
              </div>
            )}
          </div>
        </div>
      </div>

      <div class="backlinks-panel-wrapper" style={backlinksOpen.value ? '' : 'width:0;overflow:hidden'}>
        <BacklinksPanel onNavigate={handleNavigate} />
        <TagsPanel onFileClick={handleFileClick} />
      </div>

      <ContextMenu
        onRename={handleRename}
        onDelete={handleDelete}
        onDuplicate={handleDuplicate}
        onCopyPath={handleCopyPath}
        onNewFileHere={handleNewFileHere}
      />

      {searchOpen.value && <SearchDialog onSelect={handleFileClick} />}
      {quickOpenOpen.value && <QuickOpen onSelect={handleFileClick} />}
      {settingsOpen.value && <SettingsPanel />}
      {graphOpen.value && <GraphView onNavigate={handleNavigate} />}

      {newFileOpen.value && (
        <div class="new-file-overlay" onClick={(e) => {
          if ((e.target as HTMLElement).classList.contains('new-file-overlay')) newFileOpen.value = false;
        }}>
          <div class="new-file-dialog">
            <h3>New File</h3>
            <input class="new-file-input" type="text" placeholder="filename.md"
              value={newFileName.value}
              onInput={(e) => { newFileName.value = (e.target as HTMLInputElement).value; }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFile(); if (e.key === 'Escape') newFileOpen.value = false; }}
              autoFocus
            />
            <div class="new-file-actions">
              <button class="btn-secondary" onClick={() => { newFileOpen.value = false; }}>Cancel</button>
              <button class="btn-primary" onClick={handleCreateFile}>Create</button>
            </div>
          </div>
        </div>
      )}

      {renameOpen.value && (
        <div class="new-file-overlay" onClick={(e) => {
          if ((e.target as HTMLElement).classList.contains('new-file-overlay')) renameOpen.value = false;
        }}>
          <div class="new-file-dialog">
            <h3>Rename</h3>
            <input class="new-file-input" type="text" placeholder="new name"
              value={renameValue.value}
              onInput={(e) => { renameValue.value = (e.target as HTMLInputElement).value; }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDoRename(); if (e.key === 'Escape') renameOpen.value = false; }}
              autoFocus
            />
            <div class="new-file-actions">
              <button class="btn-secondary" onClick={() => { renameOpen.value = false; }}>Cancel</button>
              <button class="btn-primary" onClick={handleDoRename}>Rename</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
