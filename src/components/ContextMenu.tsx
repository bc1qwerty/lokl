import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { contextMenu } from '../lib/store';
import { t } from '../i18n';

interface Props {
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onDuplicate: (path: string) => void;
  onCopyPath: (path: string) => void;
  onNewFileHere: (dirPath: string) => void;
}

export function ContextMenu(props: Props) {
  const menu = contextMenu.value;
  if (!menu) return null;
  return <Menu key={`${menu.path}@${menu.x},${menu.y}`} menu={menu} {...props} />;
}

type MenuState = NonNullable<typeof contextMenu.value>;

function Menu({ menu, onRename, onDelete, onDuplicate, onCopyPath, onNewFileHere }: Props & { menu: MenuState }) {
  const ref = useRef<HTMLDivElement>(null);
  const str = t.value.contextMenu;
  const isDir = menu.kind === 'directory';

  useEffect(() => {
    function close() { contextMenu.value = null; }
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('resize', close);
    };
  }, []);

  // Keep the whole menu on screen. It used to be placed at the pointer as-is, so for the notes at
  // the bottom of a long tree "Delete" (and on a phone every item) was below the window edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 4;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(pad, Math.min(menu.x, window.innerWidth - width - pad));
    const top = Math.max(pad, Math.min(menu.y, window.innerHeight - height - pad));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    // opened from the keyboard or by a pointer: the items are reachable with the arrow keys either way
    const opener = document.activeElement as HTMLElement | null;
    el.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    return () => {
      // back to the row the menu was opened from — unless the action moved the focus on purpose (a dialog)
      const now = document.activeElement;
      if (opener?.isConnected && (!now || now === document.body || el.contains(now))) opener.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    const buttons = [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(at + 1) % buttons.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); buttons[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); buttons[buttons.length - 1]?.focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); contextMenu.value = null; }
  }

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
      ref={ref}
      class="context-menu"
      role="menu"
      aria-label={menu.path}
      style={`left:${menu.x}px; top:${menu.y}px`}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
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
