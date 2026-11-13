import { useSignal } from '@preact/signals';
import { useCallback, useEffect } from 'preact/hooks';
import {
  vault, fileTree, currentFilePath, openTabs,
  isDirty, sidebarOpen, backlinksOpen, viewMode, searchOpen,
  quickOpenOpen, settingsOpen, graphOpen, contextMenu,
  isLoading, addTab, closeTab, settings, currentFileContent,
} from './lib/store';
import { saveStatus, startAutosave, flushPendingSave, settleOpenNote, showNote, applyChange, expectLocalRemoval } from './lib/autosave';
import { initDB, getNote, putNote, deleteNote, listNotes, buildFileTree, watchChanges, getDB, sweepTrash, atomicRename, dbEpoch } from './lib/db';
import { updateLinksForFile } from './lib/markdown';
import { indexFile, clearIndex, removeFromIndex } from './lib/search';

import { startQuotaMonitor } from './lib/quota';
import { initSyncController } from './lib/sync-controller';
import { LoginPanel } from './components/LoginPanel';
import { QuotaBanner } from './components/QuotaBanner';
import { WelcomeScreen } from './components/WelcomeScreen';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { TabBar } from './components/TabBar';
import { lazy, Suspense } from 'preact/compat';
import { Preview } from './components/Preview';
import { BacklinksPanel } from './components/BacklinksPanel';
import { TagsPanel } from './components/TagsPanel';
import { SearchDialog } from './components/SearchDialog';
import { QuickOpen } from './components/QuickOpen';
import { ContextMenu } from './components/ContextMenu';
import { GraphView } from './components/GraphView';
import { SettingsPanel } from './components/SettingsPanel';
import { ToastContainer } from './components/Toast';
import { toast } from './lib/toast';

// 편집기(CodeMirror 묶음 ~180KB)는 파일을 처음 열 때 받는다 — 정적 import 일 때는 파일을 열기 전 환영
// 화면에서도 받았다(2026-11-12, 첫 로딩의 쓰지 않는 JS ~200KB).
const Editor = lazy(() => import('./components/Editor').then((m) => ({ default: m.Editor })));

export function App() {
  const newFileOpen = useSignal(false);
  const newFileName = useSignal('');
  const renameOpen = useSignal(false);
  const renameTarget = useSignal('');
  const renameValue = useSignal('');
  const dbError = useSignal<string | null>(null);

  // Initialize PouchDB on mount
  useEffect(() => {
    initDB();
    sweepTrash().catch(e => console.error('sweepTrash failed:', e));
    const stop = startQuotaMonitor();
    const stopSyncController = initSyncController();
    // Check if DB has any notes — skip WelcomeScreen if so
    getDB().info().then((info) => {
      if (info.doc_count > 0) {
        loadNotes();
      } else {
        // Empty DB: show WelcomeScreen (vault stays null)
        vault.value = null;
        isLoading.value = false;
      }
    }).catch((e: any) => {
      // IndexedDB refused to open (corruption, private mode, quota). Without
      // this the app fell through to WelcomeScreen as if the data were gone.
      console.error('Storage unavailable:', e);
      dbError.value = e?.message ?? 'IndexedDB error';
      isLoading.value = false;
    });
    return () => { stop(); stopSyncController(); };
  }, []);

  async function loadNotes() {
    isLoading.value = true;
    try {
      const notes = await listNotes();
      fileTree.value = buildFileTree(notes);
      clearIndex();
      for (const note of notes) {
        indexFile(note._id, note.content);
        updateLinksForFile(note._id, note.content);
      }
      vault.value = { mode: 'pouchdb', name: 'lokl' };
    } catch (e: any) {
      console.error('Failed to load notes:', e);
      dbError.value = e?.message ?? 'IndexedDB error';
    } finally {
      isLoading.value = false;
    }
  }

  // Auto-save with debounce (logic lives in lib/autosave so it can be tested without the UI)
  useEffect(() => startAutosave(), []);

  // PouchDB change feed (replaces 3s polling)
  useEffect(() => {
    const watcher = watchChanges((doc) => {
      if (applyChange(doc) === 'closed') {
        removeFromIndex(doc._id);
        // The open note was removed elsewhere (another tab, another device):
        // fall back to the last remaining tab instead of an editor with no note.
        const rest = openTabs.value;
        if (!currentFilePath.value && rest.length > 0) void handleFileClick(rest[rest.length - 1]);
      }
      // Rebuild file tree on any change
      listNotes().then(notes => {
        fileTree.value = buildFileTree(notes);
      });
    });
    return () => watcher.cancel();
    // re-attach when the database handle is replaced (reopenDB)
  }, [dbEpoch.value]);

  // Open file (with tab)
  const handleFileClick = useCallback(async (path: string) => {
    try {
      if (path === currentFilePath.value) { await settleOpenNote(); return; }
      const note = await getNote(path);
      if (!note) return;
      // Unsaved edits belong to the note being left. If they can't be saved,
      // stay on it rather than drop them. Nothing is awaited between the settle
      // resolving clean and showNote below, so no keystroke can fall in between
      // (the note was fetched first for that reason).
      if (!(await settleOpenNote()) || isDirty.value) return;
      showNote(path, note.content, note._rev);
      addTab(path);
      saveStatus.value = 'clean';
    } catch (e) {
      console.error('Failed to read file:', e);
    }
  }, []);

  // Close a tab. closeTab() only moves currentFilePath; the editor text has to be
  // swapped with it, or the next save writes the closed note's text into the
  // note that became current.
  const handleTabClose = useCallback(async (path: string, opts: { save?: boolean } = {}) => {
    if (currentFilePath.value !== path) { closeTab(path); return; }
    if (opts.save !== false && !(await settleOpenNote())) return;
    showNote(null, '');
    closeTab(path);
    const rest = openTabs.value;
    if (rest.length > 0) await handleFileClick(rest[rest.length - 1]);
  }, [handleFileClick]);

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
    newFileName.value = '';
    newFileOpen.value = true;
  }, []);

  const handleCreateFile = useCallback(async () => {
    const name = newFileName.value.trim();
    if (!name) return;
    const path = name.endsWith('.md') ? name : `${name}.md`;
    try {
      // An existing note with this name is opened, never blanked.
      if (await getNote(path)) {
        newFileOpen.value = false;
        await handleFileClick(path);
        return;
      }
      await putNote(path, '');
      const notes = await listNotes();
      fileTree.value = buildFileTree(notes);
      newFileOpen.value = false;
      await handleFileClick(path);
    } catch (e: any) {
      console.error('Failed to create file:', e);
      toast.error(`Create failed: ${e?.message ?? 'unknown error'}`);
    }
  }, [handleFileClick]);

  // Daily note
  const handleDailyNote = useCallback(async () => {
    // Local date, not toISOString (UTC) — a KST user before 09:00 would get
    // yesterday's note.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const path = `${today}.md`;
    const existing = await getNote(path);
    if (existing) {
      await handleFileClick(path);
    } else {
      const content = `# ${today}\n\n`;
      await putNote(path, content);
      indexFile(path, content);
      const notes = await listNotes();
      fileTree.value = buildFileTree(notes);
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
    if (!newName) return;
    if (!newName.endsWith('.md')) newName += '.md';
    const dir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/') + 1) : '';
    const newPath = dir + newName;
    // The old id's tombstone reaches the change feed while we are still here;
    // it must not close the editor under us.
    const done = expectLocalRemoval(oldPath);
    try {
      if (currentFilePath.value === oldPath && !(await settleOpenNote())) return;
      await atomicRename(oldPath, newPath);
      removeFromIndex(oldPath);
      const renamed = await getNote(newPath);
      if (renamed) indexFile(newPath, renamed.content);
      renameOpen.value = false;
      if (currentFilePath.value === oldPath && renamed) {
        // Anything typed while the rename was running rides along as a draft
        // of the renamed note instead of being dropped (or saved to the old id).
        const draft = isDirty.value ? currentFileContent.value : undefined;
        showNote(newPath, renamed.content, renamed._rev, draft);
        closeTab(oldPath);
        addTab(newPath);
        saveStatus.value = draft === undefined ? 'clean' : 'dirty';
      } else if (openTabs.value.includes(oldPath)) {
        closeTab(oldPath);
      }
      const notes = await listNotes();
      fileTree.value = buildFileTree(notes);
    } catch (e: any) {
      console.error('Rename failed:', e);
      toast.error(`Rename failed: ${e?.message ?? 'unknown error'}`);
    } finally {
      done();
    }
  }, [handleFileClick]);

  const handleDelete = useCallback(async (path: string) => {
    if (!confirm(`Delete "${path.split('/').pop()}"?`)) return;
    try {
      if (currentFilePath.value === path) {
        // Land the latest text first so the trash copy is complete, then empty
        // the editor BEFORE trashing: a debounce left pending here used to fire
        // after the delete and bring the note back.
        if (!(await settleOpenNote())) return;
        await handleTabClose(path, { save: false });
      } else if (openTabs.value.includes(path)) {
        closeTab(path);
      }
      await deleteNote(path);
      removeFromIndex(path);
      const notes = await listNotes();
      fileTree.value = buildFileTree(notes);
    } catch (e: any) {
      console.error('Delete failed:', e);
      toast.error(`Delete failed: ${e?.message ?? 'unknown error'}`);
    }
  }, [handleTabClose]);

  const handleDuplicate = useCallback(async (path: string) => {
    const name = path.split('/').pop()?.replace(/\.md$/, '') || 'untitled';
    const dir = path.includes('/') ? path.substring(0, path.lastIndexOf('/') + 1) : '';
    try {
      const note = await getNote(path);
      if (!note) return;
      // Never land on an existing note — "X copy" may already be one.
      let newPath = `${dir}${name} copy.md`;
      for (let n = 2; await getNote(newPath); n++) newPath = `${dir}${name} copy ${n}.md`;
      await putNote(newPath, note.content);
      indexFile(newPath, note.content);
      const notes = await listNotes();
      fileTree.value = buildFileTree(notes);
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
        void flushPendingSave();
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

  // Guard tab/window close while content is unsaved
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty.value || saveStatus.value === 'saving') {
        e.preventDefault();
        // Required by Chrome (deprecated assignment but still needed):
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Storage failed to open — showing WelcomeScreen here would look like data
  // loss and invite a re-import onto a broken DB.
  if (dbError.value) {
    return (
      <main class="welcome">
        <div class="welcome-logo">Lokl</div>
        <p class="welcome-tagline">Storage unavailable: {dbError.value}</p>
        <p class="welcome-tagline">
          Your notes were not deleted — the browser could not open local storage.
          Reload to retry; private browsing can block IndexedDB.
        </p>
      </main>
    );
  }

  // Show welcome screen until PouchDB is initialized (vault set by loadNotes)
  if (!vault.value) {
    return <WelcomeScreen onLoadComplete={loadNotes} />;
  }

  const mode = viewMode.value;

  return (
    <div
      class="app-layout"
      data-sidebar={sidebarOpen.value ? 'open' : 'closed'}
      data-backlinks={backlinksOpen.value ? 'open' : 'closed'}
    >
      <QuotaBanner />
      <Toolbar saveStatus={saveStatus.value} onDailyNote={handleDailyNote} />

      <Sidebar onFileClick={handleFileClick} onNewFile={handleNewFile}>
        <LoginPanel />
      </Sidebar>

      <main class="main-content">
        <div style="display:flex; flex-direction:column; flex:1; min-width:0; overflow:hidden">
          <TabBar onTabClick={handleTabClick} onTabClose={handleTabClose} />
          <div style="display:flex; flex:1; overflow:hidden">
            {(mode === 'edit' || mode === 'split') && (
              <Suspense fallback={null}>
                <Editor />
              </Suspense>
            )}
            {(mode === 'preview' || mode === 'split') && <Preview onNavigate={handleNavigate} />}
            {!currentFilePath.value && (
              <div style="flex:1; display:flex; align-items:center; justify-content:center; color:var(--text-muted); font-size:14px">
                Select a file to start editing
              </div>
            )}
          </div>
        </div>
      </main>

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

      <ToastContainer />
    </div>
  );
}
