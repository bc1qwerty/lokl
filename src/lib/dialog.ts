import { useLayoutEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

/**
 * Modal behaviour for a dialog element:
 *  - focus moves in when it opens (`[data-autofocus]`, else the first focusable) — the
 *    `autofocus` attribute is honoured once per document, so later dialogs opened with
 *    the focus still on the button behind them and typing went nowhere (or into the editor);
 *  - Tab cycles inside instead of walking off into the page behind;
 *  - focus returns to whatever opened it when it closes.
 */
export function useDialog(ref: RefObject<HTMLElement>, opts: { select?: boolean } = {}): void {
  // Layout effect, not a passive one: focus has to be inside before the next key event. A passive
  // effect runs after paint, and "Ctrl+P, type, Enter" typed fast landed on whatever had the focus
  // behind the dialog (Enter then pressed that button).
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement as HTMLElement | null;
    const first = root.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(root)[0] ?? root;
    first.focus();
    if (opts.select && first instanceof HTMLInputElement) first.select();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const items = focusables(root!);
      if (items.length === 0) { e.preventDefault(); return; }
      const head = items[0], tail = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!active || !root!.contains(active)) { e.preventDefault(); head.focus(); }
      else if (e.shiftKey && active === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && active === tail) { e.preventDefault(); head.focus(); }
    }
    root.addEventListener('keydown', onKeyDown);
    return () => {
      root.removeEventListener('keydown', onKeyDown);
      // only if the page behind did not take the focus on purpose (a note that was just opened)
      const now = document.activeElement;
      if (opener && opener.isConnected && (!now || now === document.body || root.contains(now))) opener.focus();
    };
  }, []);
}

/** Keep the keyboard-selected row of a result list in view. */
export function useSelectedInView(ref: RefObject<HTMLElement>, selected: number): void {
  useLayoutEffect(() => {
    const row = ref.current?.querySelector<HTMLElement>('.selected');
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [selected]);
}
