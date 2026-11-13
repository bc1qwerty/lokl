import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { t } from '../i18n';
import { vault, fileTree, searchOpen, settings, sortTree, sidebarOpen } from '../lib/store';
import { FileTree, useRovingTree } from './FileTree';
import { ConflictPanel } from './ConflictPanel';
import { TrashPanel } from './TrashPanel';

interface Props {
  onFileClick: (path: string) => void;
  onNewFile: () => void;
  children?: ComponentChildren;
}

export function Sidebar({ onFileClick, onNewFile, children }: Props) {
  const str = t.value.sidebar;
  const v = vault.value;
  const treeRef = useRef<HTMLDivElement>(null);
  useRovingTree(treeRef);

  return (
    // A closed sidebar is only 0px wide: its rows and buttons stayed in the tab order (and in the
    // accessibility tree), so Tab walked through things nobody could see. `inert` takes them out.
    <aside class="sidebar" inert={!sidebarOpen.value}>
      <div class="sidebar-header">
        <h2>{v?.name || 'Lokl'}</h2>
        <div class="sidebar-actions">
          <button
            class="sidebar-action-btn"
            title={str.newFile}
            aria-label={str.newFile}
            onClick={onNewFile}
          >+</button>
        </div>
      </div>

      <div class="sidebar-search">
        <input
          class="sidebar-search-input"
          type="text"
          placeholder={str.search}
          aria-label={str.search}
          readOnly
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); searchOpen.value = true; } }}
          onClick={() => { searchOpen.value = true; }}
        />
      </div>

      <div class="file-tree" role="tree" aria-label={str.files} ref={treeRef}>
        {fileTree.value.length > 0 ? (
          <FileTree entries={sortTree(fileTree.value, settings.value.sortBy)} onFileClick={onFileClick} />
        ) : (
          <div style="padding: 16px 12px; font-size: 12px; color: var(--text-muted)">
            {str.noFiles}
          </div>
        )}
      </div>
      <ConflictPanel onOpen={onFileClick} />
      <TrashPanel />
      {children && <div class="sidebar-footer">{children}</div>}
    </aside>
  );
}
