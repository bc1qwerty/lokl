import { useEffect } from 'preact/hooks';
import { contextMenu } from '../lib/store';
import { t } from '../i18n';

interface Props {
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onDuplicate: (path: string) => void;
  onCopyPath: (path: string) => void;
  onNewFileHere: (dirPath: string) => void;
}

export function ContextMenu({ onRename, onDelete, onDuplicate, onCopyPath, onNewFileHere }: Props) {
  const menu = contextMenu.value;
  if (!menu) return null;

  const str = t.value.contextMenu;
  const isDir = menu.kind === 'directory';

  useEffect(() => {
    function close() { contextMenu.value = null; }
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, []);

  const items = isDir
    ? [
        { label: str.newFileHere, action: () => onNewFileHere(menu.path) },
        { label: str.copyPath, action: () => onCopyPath(menu.path) },
      ]
    : [
        { label: str.rename, action: () => onRename(menu.path) },
        { label: str.duplicateFile, action: () => onDuplicate(menu.path) },
        { label: str.copyPath, action: () => onCopyPath(menu.path) },
        { label: str.delete, action: () => onDelete(menu.path), danger: true },
      ];

  return (
    <div
      class="context-menu"
      style={`left:${menu.x}px; top:${menu.y}px`}
    >
      {items.map((item) => (
        <button
          key={item.label}
          class={`context-menu-item${(item as any).danger ? ' danger' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            contextMenu.value = null;
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
