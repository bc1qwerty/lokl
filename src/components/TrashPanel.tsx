import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { listTrash, restoreNote, purgeNote } from '../lib/db';
import type { NoteDoc } from '../lib/db';
import { t } from '../i18n';

export function TrashPanel() {
  const items = useSignal<NoteDoc[]>([]);
  const open = useSignal(false);

  async function refresh() {
    items.value = await listTrash();
  }

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (cancelled) return;
      items.value = await listTrash();
    }
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const str = t.value.trash;

  return (
    <div class="trash-panel">
      <button
        class="trash-toggle"
        onClick={() => {
          if (items.value.length === 0) return;
          open.value = !open.value;
          if (open.value) refresh();
        }}
        aria-expanded={open.value}
      >
        {str.title} ({items.value.length})
      </button>
      {open.value && items.value.length > 0 && (
        <ul class="trash-list">
          {items.value.map(n => (
            <li key={n._id}>
              <span class="trash-path" title={n._id}>{n._id}</span>
              {n.trashedAt && (
                <small class="trash-date">{n.trashedAt.slice(0, 10)}</small>
              )}
              <button
                class="trash-restore"
                title={`${str.restore}: ${n._id}`}
                aria-label={`${str.restore}: ${n._id}`}
                onClick={async () => {
                  await restoreNote(n._id);
                  await refresh();
                }}
              >
                {str.restore}
              </button>
              <button
                class="trash-purge"
                title={`${str.deleteForever}: ${n._id}`}
                aria-label={`${str.deleteForever}: ${n._id}`}
                onClick={async () => {
                  await purgeNote(n._id);
                  await refresh();
                }}
              >
                {str.deleteForever}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
