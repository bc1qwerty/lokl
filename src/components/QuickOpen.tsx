import { useRef, useEffect } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { allFilePaths, quickOpenOpen } from '../lib/store';
import { t } from '../i18n';

interface Props {
  onSelect: (path: string) => void;
}

export function QuickOpen({ onSelect }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const query = useSignal('');
  const selectedIdx = useSignal(0);
  const str = t.value.quickOpen;

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = (() => {
    const q = query.value.toLowerCase();
    if (!q) return allFilePaths.value.slice(0, 30);
    return allFilePaths.value
      .filter((p) => p.toLowerCase().includes(q))
      .slice(0, 30);
  })();

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx.value = (selectedIdx.value + 1) % Math.max(filtered.length, 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx.value = (selectedIdx.value - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = filtered[selectedIdx.value];
      if (item) {
        quickOpenOpen.value = false;
        onSelect(item);
      }
    } else if (e.key === 'Escape') {
      quickOpenOpen.value = false;
    }
  }

  return (
    <div class="search-overlay" onClick={(e) => {
      if ((e.target as HTMLElement).classList.contains('search-overlay')) quickOpenOpen.value = false;
    }}>
      <div class="search-dialog">
        <div class="search-input-wrapper">
          <span class="search-icon">&#128196;</span>
          <input
            ref={inputRef}
            class="search-input"
            type="text"
            placeholder={str.placeholder}
            value={query.value}
            onInput={(e) => {
              query.value = (e.target as HTMLInputElement).value;
              selectedIdx.value = 0;
            }}
            onKeyDown={handleKeyDown}
          />
          <span class="search-kbd">ESC</span>
        </div>
        <div class="search-results">
          {filtered.length === 0 && (
            <div class="search-empty">{str.noResults}</div>
          )}
          {filtered.map((path, i) => {
            const name = path.split('/').pop()?.replace(/\.md$/, '') || path;
            return (
              <div
                key={path}
                class={`search-result-item${i === selectedIdx.value ? ' selected' : ''}`}
                onClick={() => {
                  quickOpenOpen.value = false;
                  onSelect(path);
                }}
              >
                <span class="search-result-title">{name}</span>
                <span class="search-result-path">{path}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
