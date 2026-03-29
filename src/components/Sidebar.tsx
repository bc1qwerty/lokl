import { t } from '../i18n';
import { vault, fileTree, searchOpen } from '../lib/store';
import { FileTree } from './FileTree';

interface Props {
  onFileClick: (path: string) => void;
  onNewFile: () => void;
}

export function Sidebar({ onFileClick, onNewFile }: Props) {
  const str = t.value.sidebar;
  const v = vault.value;

  return (
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>{v?.name || 'Lokl'}</h2>
        <div class="sidebar-actions">
          <button
            class="sidebar-action-btn"
            title={str.newFile}
            onClick={onNewFile}
          >+</button>
        </div>
      </div>

      <div class="sidebar-search">
        <input
          class="sidebar-search-input"
          type="text"
          placeholder={str.search}
          readOnly
          onClick={() => { searchOpen.value = true; }}
        />
      </div>

      <div class="file-tree">
        {fileTree.value.length > 0 ? (
          <FileTree entries={fileTree.value} onFileClick={onFileClick} />
        ) : (
          <div style="padding: 16px 12px; font-size: 12px; color: var(--text-muted)">
            {str.noFiles}
          </div>
        )}
      </div>
    </aside>
  );
}
