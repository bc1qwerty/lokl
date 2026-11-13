import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';
import { currentFilePath, contextMenu } from '../lib/store';
import { t } from '../i18n';
import type { FileEntry } from '../types';

interface Props {
  entries: FileEntry[];
  depth?: number;
  onFileClick: (path: string) => void;
}

const ROW = '.tree-item';

function rowsOf(tree: Element | null): HTMLElement[] {
  return tree ? [...tree.querySelectorAll<HTMLElement>(ROW)] : [];
}

/**
 * One tab stop for the whole tree (roving tabindex). Every row used to be a tab stop: with 30 notes
 * it took 51 presses of Tab to reach the editor. Rows render with tabindex -1; this keeps exactly one
 * of them at 0 — the row that last had the focus, else the open note, else the first row — as rows
 * come and go (folders opening, notes created, renamed, removed).
 */
export function useRovingTree(ref: RefObject<HTMLElement>): void {
  useEffect(() => {
    const tree = ref.current;
    if (!tree) return;
    let last: string | null = null;
    // The row that has the focus right now. A re-sort ("Sort by: Modified" after a save) moves rows in
    // the DOM, and a moved element silently loses the focus — a keyboard user in the tree was dropped
    // to <body>. The browser reports that like any other blur (focusout, nothing gaining the focus), so
    // the row is remembered for a moment after such a blur: tree changed + focus on <body> right after
    // = it was taken away, not given up.
    let held: string | null = null;
    let release: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      const rows = rowsOf(tree);
      if (rows.length === 0) return;
      if (held !== null && (!document.activeElement || document.activeElement === document.body)) {
        rows.find((r) => r.dataset.path === held)?.focus({ preventScroll: true });
      }
      const keep = rows.find((r) => r === document.activeElement)
        ?? rows.find((r) => last !== null && r.dataset.path === last)
        ?? rows.find((r) => r.classList.contains('active'))
        ?? rows[0];
      for (const r of rows) {
        const want = r === keep ? '0' : '-1';
        if (r.getAttribute('tabindex') !== want) r.setAttribute('tabindex', want);
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const row = (e.target as HTMLElement).closest?.(ROW) as HTMLElement | null;
      clearTimeout(release);
      if (row && tree.contains(row)) { last = row.dataset.path ?? null; held = e.target === row ? last : null; sync(); }
    };
    const onFocusOut = (e: FocusEvent) => {
      clearTimeout(release);
      if (e.relatedTarget) held = null;                       // the focus went somewhere on purpose
      else release = setTimeout(() => { held = null; }, 100);  // maybe a moved row — sync() decides
    };
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(tree, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    tree.addEventListener('focusin', onFocusIn);
    tree.addEventListener('focusout', onFocusOut);
    return () => { clearTimeout(release); mo.disconnect(); tree.removeEventListener('focusin', onFocusIn); tree.removeEventListener('focusout', onFocusOut); };
  }, []);
}

/** Put the keyboard focus on a note's row (after a rename or a delete took its old row away). */
export function focusTreeRow(path?: string): void {
  const rows = rowsOf(document.querySelector('.file-tree'));
  const row = (path ? rows.find((r) => r.dataset.path === path) : undefined)
    ?? rows.find((r) => r.getAttribute('tabindex') === '0') ?? rows[0];
  row?.focus();
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
  const isDir = entry.kind === 'directory';

  function openMenuAt(x: number, y: number) {
    contextMenu.value = { x, y, path: entry.path, kind: entry.kind };
  }

  function handleContext(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e.clientX, e.clientY);
  }

  // The rows were mouse-only divs: with a keyboard a note could be opened (Ctrl+P) but never
  // renamed, duplicated or deleted. Enter/Space = click, Shift+F10 or the Menu key = context menu,
  // arrows walk the visible rows, Left/Right fold and unfold folders (the tree pattern).
  function handleKey(e: KeyboardEvent, activate: () => void) {
    if (e.target !== e.currentTarget) return;
    const row = e.currentTarget as HTMLElement;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); return; }
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      const r = row.getBoundingClientRect();
      openMenuAt(Math.round(r.left + 24), Math.round(r.bottom));
      return;
    }
    const rows = rowsOf(row.closest('.file-tree'));
    const at = rows.indexOf(row);
    let next: HTMLElement | undefined;
    if (e.key === 'ArrowDown') next = rows[at + 1];
    else if (e.key === 'ArrowUp') next = rows[at - 1];
    else if (e.key === 'Home') next = rows[0];
    else if (e.key === 'End') next = rows[rows.length - 1];
    else if (e.key === 'ArrowRight' && isDir) {
      if (!expanded.value) { e.preventDefault(); expanded.value = true; return; }
      const child = rows[at + 1];
      if (child && Number(child.dataset.depth) > depth) next = child;
    } else if (e.key === 'ArrowLeft') {
      if (isDir && expanded.value) { e.preventDefault(); expanded.value = false; return; }
      for (let i = at - 1; i >= 0; i--) {
        if (Number(rows[i].dataset.depth) < depth) { next = rows[i]; break; }
      }
    } else return;
    if (next) { e.preventDefault(); next.focus(); }
  }

  // Touch has no right click, and iOS Safari does not fire `contextmenu` on a long press: without
  // this button rename, duplicate and delete had no touch path at all. Shown where there is no
  // hover (and on narrow windows); the keyboard path stays Shift+F10 on the row.
  const more = (
    <button
      class="tree-item-more"
      tabIndex={-1}
      aria-label={`${t.value.a11y.moreActions}: ${entry.name.replace(/\.md$/, '')}`}
      aria-haspopup="menu"
      onClick={(e) => {
        e.stopPropagation();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        openMenuAt(Math.round(r.left), Math.round(r.bottom));
      }}
    >⋯</button>
  );

  if (isDir) {
    const toggle = () => { expanded.value = !expanded.value; };
    return (
      <>
        <div
          class="tree-item"
          style={`--depth: ${depth}`}
          role="treeitem"
          tabIndex={-1}
          data-path={entry.path}
          data-depth={depth}
          aria-level={depth + 1}
          aria-expanded={expanded.value}
          onClick={toggle}
          onKeyDown={(e) => handleKey(e, toggle)}
          onContextMenu={handleContext}
        >
          <span class="tree-item-icon">{expanded.value ? '▾' : '▸'}</span>
          <span class="tree-item-name">{entry.name}</span>
          {more}
        </div>
        {expanded.value && entry.children && (
          <div role="group">
            <FileTree entries={entry.children} depth={depth + 1} onFileClick={onFileClick} />
          </div>
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
      tabIndex={-1}
      data-path={entry.path}
      data-depth={depth}
      aria-level={depth + 1}
      aria-selected={isActive}
      aria-current={isActive ? 'page' : undefined}
      onClick={() => onFileClick(entry.path)}
      onKeyDown={(e) => handleKey(e, () => onFileClick(entry.path))}
      onContextMenu={handleContext}
    >
      <span class="tree-item-icon">&#128196;</span>
      <span class="tree-item-name">{displayName}</span>
      {more}
    </div>
  );
}
