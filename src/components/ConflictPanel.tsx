import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { listConflictSiblings, deleteNote, getDB } from '../lib/db';
import type { NoteDoc } from '../lib/db';
import { t } from '../i18n';

interface Props {
  onOpen: (path: string) => void;
}

export function ConflictPanel({ onOpen }: Props) {
  const items = useSignal<NoteDoc[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const siblings = await listConflictSiblings();
      if (!cancelled) items.value = siblings;
    }
    refresh();
    const id = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (items.value.length === 0) return null;

  const str = t.value.conflicts;

  return (
    <div class="conflict-panel">
      <div class="conflict-panel-header">
        <span>{str.title}</span>
        <span class="conflict-count">{items.value.length}</span>
      </div>
      <ul class="conflict-list">
        {items.value.map(c => (
          <li key={c._id} class="conflict-item">
            <button
              class="conflict-open"
              onClick={() => onOpen(c._id)}
              title={c._id}
            >
              {c._id.split('/').pop()}
            </button>
            <div class="conflict-actions">
              {c.conflictOf && (
                <button
                  class="conflict-open-orig"
                  onClick={async () => {
                    // Read the pointer now: a rename since the last poll moved it.
                    let target = c.conflictOf!;
                    try { target = (await getDB().get(c._id)).conflictOf ?? target; } catch { /* use the listed one */ }
                    onOpen(target);
                  }}
                  title={c.conflictOf}
                >
                  {str.openOriginal}
                </button>
              )}
              <button
                class="conflict-discard"
                title={`${t.value.conflicts.discard}: ${c._id}`}
                aria-label={`${t.value.conflicts.discard}: ${c._id}`}
                onClick={async () => {
                  await deleteNote(c._id);
                  // The 3s poll will refresh items.value; force an immediate refresh too:
                  items.value = await listConflictSiblings();
                }}
              >
                {t.value.conflicts.discard}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
