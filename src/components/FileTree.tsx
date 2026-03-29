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

  if (entry.kind === 'directory') {
    return (
      <>
        <div
          class="tree-item"
          style={`--depth: ${depth}`}
          onClick={() => { expanded.value = !expanded.value; }}
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
      onClick={() => onFileClick(entry.path)}
      onContextMenu={handleContext}
    >
      <span class="tree-item-icon">&#128196;</span>
      <span class="tree-item-name">{displayName}</span>
    </div>
  );
}
