import { useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { search } from '../lib/search';
import { searchOpen } from '../lib/store';
import { t } from '../i18n';
import { useDialog, useSelectedInView } from '../lib/dialog';

interface Props {
  onSelect: (path: string) => void;
}

export function SearchDialog({ onSelect }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const query = useSignal('');
  const selectedIdx = useSignal(0);
  const results = useSignal<any[]>([]);
  const str = t.value.search;

  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef);
  // arrow keys used to move the selection out of sight (13 of 20 results were chosen blind)
  useSelectedInView(listRef, selectedIdx.value);

  function handleInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    query.value = val;
    selectedIdx.value = 0;
    results.value = search(val);
  }

  function handleKeyDown(e: KeyboardEvent) {
    const len = results.value.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx.value = (selectedIdx.value + 1) % Math.max(len, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx.value = (selectedIdx.value - 1 + Math.max(len, 1)) % Math.max(len, 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results.value[selectedIdx.value];
      if (item) {
        searchOpen.value = false;
        onSelect(item.path);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      searchOpen.value = false;
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('search-overlay')) {
      searchOpen.value = false;
    }
  }

  return (
    <div class="search-overlay" onClick={handleOverlayClick}>
      <div class="search-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label={str.placeholder}>
        <div class="search-input-wrapper">
          <span class="search-icon">&#128269;</span>
          <input
            ref={inputRef}
            class="search-input"
            type="text"
            placeholder={str.placeholder}
            aria-label={str.placeholder}
            data-autofocus
            value={query.value}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
          />
          <span class="search-kbd">ESC</span>
        </div>
        <div class="search-results" ref={listRef}>
          {query.value && results.value.length === 0 && (
            <div class="search-empty">{str.noResults}</div>
          )}
          {!query.value && (
            <div class="search-empty">{str.hint}</div>
          )}
          {results.value.map((r, i) => (
            <div
              key={r.id}
              class={`search-result-item${i === selectedIdx.value ? ' selected' : ''}`}
              onClick={() => {
                searchOpen.value = false;
                onSelect(r.path);
              }}
            >
              <span class="search-result-title">{r.title}</span>
              <span class="search-result-path">{r.path}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
