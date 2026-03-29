import { backlinksIndex, currentFilePath } from '../lib/store';
import { t } from '../i18n';

interface Props {
  onNavigate: (path: string) => void;
}

export function BacklinksPanel({ onNavigate }: Props) {
  const str = t.value.backlinks;
  const path = currentFilePath.value;
  const links = path ? backlinksIndex.value.get(path) : null;
  const items = links ? Array.from(links) : [];

  return (
    <div class="backlinks-panel">
      <div class="backlinks-header">{str.title}</div>
      {items.length === 0 ? (
        <div class="backlinks-empty">{str.none}</div>
      ) : (
        items.map((sourcePath) => {
          const name = sourcePath.split('/').pop()?.replace(/\.md$/, '') || sourcePath;
          return (
            <div
              key={sourcePath}
              class="backlink-item"
              onClick={() => onNavigate(sourcePath)}
            >
              <div class="backlink-item-title">{name}</div>
              <div class="backlink-item-context">{sourcePath}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
