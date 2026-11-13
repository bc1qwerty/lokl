import { useSignal } from '@preact/signals';
import { currentFilePath, contextMenu } from '../lib/store';
import type { FileEntry } from '../types';

interface Props {
  entries: FileEntry[];
  depth?: number;
  onFileClick: (path: string) => void;
}

export function FileTree({ entries, depth = 0, onFileClick }: Props) {
  return (
    <>
      {entries.map((entry) => (
        <FileTreeItem key={entry.path} entry={entry} depth={depth} onFileClick={onFileClick} />
      ))}
    </>
  );
}

function FileTreeItem({ entry, depth, onFileClick }: { entry: FileEntry; depth: number; onFileClick: (path: string) => void }) {
  const expanded = useSignal(depth === 0);

  function handleContext(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    contextMenu.value = { x: e.clientX, y: e.clientY, path: entry.path, kind: entry.kind };
  }

  // The rows were mouse-only divs: with a keyboard a note could be opened (Ctrl+P) but never
  // renamed, duplicated or deleted. Enter/Space = click, Shift+F10 or the Menu key = context menu.
  function handleKey(e: KeyboardEvent, activate: () => void) {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); return; }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      contextMenu.value = { x: Math.round(r.left + 24), y: Math.round(r.bottom), path: entry.path, kind: entry.kind };
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const rows = [...document.querySelectorAll<HTMLElement>('.file-tree .tree-item')];
      const next = rows[rows.indexOf(e.currentTarget as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) { e.preventDefault(); next.focus(); }
    }
  }

  if (entry.kind === 'directory') {
    return (
      <>
        <div
          class="tree-item"
          style={`--depth: ${depth}`}
          role="treeitem"
          tabIndex={0}
          aria-expanded={expanded.value}
          onClick={() => { expanded.value = !expanded.value; }}
          onKeyDown={(e) => handleKey(e, () => { expanded.value = !expanded.value; })}
          onContextMenu={handleContext}
        >
          <span class="tree-item-icon">{expanded.value ? '▾' : '▸'}</span>
          <span class="tree-item-name">{entry.name}</span>
        </div>
        {expanded.value && entry.children && (
          <FileTree entries={entry.children} depth={depth + 1} onFileClick={onFileClick} />
        )}
      </>
    );
  }

  const isActive = currentFilePath.value === entry.path;
  const displayName = entry.name.replace(/\.md$/, '');

  return (
    <div
      class={`tree-item${isActive ? ' active' : ''}`}
      style={`--depth: ${depth}`}
      role="treeitem"
      tabIndex={0}
      aria-selected={isActive}
      onClick={() => onFileClick(entry.path)}
      onKeyDown={(e) => handleKey(e, () => onFileClick(entry.path))}
      onContextMenu={handleContext}
    >
      <span class="tree-item-icon">&#128196;</span>
      <span class="tree-item-name">{displayName}</span>
    </div>
  );
}
