import { useSignal } from '@preact/signals';
import { currentFilePath } from '../lib/store';
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
        <FileTreeItem
          key={entry.path}
          entry={entry}
          depth={depth}
          onFileClick={onFileClick}
        />
      ))}
    </>
  );
}

function FileTreeItem({
  entry,
  depth,
  onFileClick,
}: {
  entry: FileEntry;
  depth: number;
  onFileClick: (path: string) => void;
}) {
  const expanded = useSignal(depth === 0);

  if (entry.kind === 'directory') {
    return (
      <>
        <div
          class="tree-item"
          style={`--depth: ${depth}`}
          onClick={() => { expanded.value = !expanded.value; }}
        >
          <span class="tree-item-icon">{expanded.value ? '▾' : '▸'}</span>
          <span class="tree-item-name">{entry.name}</span>
        </div>
        {expanded.value && entry.children && (
          <FileTree
            entries={entry.children}
            depth={depth + 1}
            onFileClick={onFileClick}
          />
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
    >
      <span class="tree-item-icon">📄</span>
      <span class="tree-item-name">{displayName}</span>
    </div>
  );
}
