import { tagsIndex, activeTagFilter } from '../lib/store';
import { t } from '../i18n';

interface Props {
  onFileClick: (path: string) => void;
}

export function TagsPanel({ onFileClick }: Props) {
  const str = t.value.tags;
  const tags = tagsIndex.value;
  const active = activeTagFilter.value;

  const sorted = Array.from(tags.entries())
    .sort((a, b) => b[1].size - a[1].size);

  if (sorted.length === 0) {
    return (
      <div class="tags-section">
        <div class="backlinks-header">{str.title}</div>
        <div class="backlinks-empty">{str.none}</div>
      </div>
    );
  }

  return (
    <div class="tags-section">
      <div class="backlinks-header">
        {str.title}
        {active && (
          <button class="tag-clear-btn" onClick={() => { activeTagFilter.value = null; }}>
            {str.clearFilter}
          </button>
        )}
      </div>
      <div class="tags-list">
        {sorted.map(([tag, paths]) => (
          <button
            key={tag}
            class={`tag-item${active === tag ? ' active' : ''}`}
            onClick={() => {
              activeTagFilter.value = active === tag ? null : tag;
            }}
          >
            <span class="tag-name">#{tag}</span>
            <span class="tag-count">{paths.size}</span>
          </button>
        ))}
      </div>
      {active && (
        <div class="tag-files">
          {Array.from(tags.get(active) || []).map((path) => {
            const name = path.split('/').pop()?.replace(/\.md$/, '') || path;
            return (
              <div
                key={path}
                class="backlink-item"
                onClick={() => onFileClick(path)}
              >
                <div class="backlink-item-title">{name}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
