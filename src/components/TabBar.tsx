import { openTabs, currentFilePath } from '../lib/store';
import { t } from '../i18n';

interface Props {
  onTabClick: (path: string) => void;
  onTabClose: (path: string) => void;
}

export function TabBar({ onTabClick, onTabClose }: Props) {
  const tabs = openTabs.value;
  if (tabs.length === 0) return null;

  return (
    <div class="tab-bar">
      {tabs.map((path) => {
        const name = path.split('/').pop()?.replace(/\.md$/, '') || path;
        const isActive = currentFilePath.value === path;
        return (
          <div
            key={path}
            class={`tab-item${isActive ? ' active' : ''}`}
            onClick={() => onTabClick(path)}
            title={path}
          >
            <span class="tab-name">{name}</span>
            <button
              class="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(path);
              }}
              title={t.value.tabs.close}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
