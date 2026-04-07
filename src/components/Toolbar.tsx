import { t } from '../i18n';
import { theme, toggleTheme } from '../lib/theme';
import {
  vault,
  currentFilePath,
  sidebarOpen,
  backlinksOpen,
  viewMode,
  isReadOnly,
  graphOpen,
  settingsOpen,
} from '../lib/store';
import { SyncStatus } from './SyncStatus';
import type { ViewMode } from '../types';

interface Props {
  saveStatus: 'clean' | 'dirty' | 'saving' | 'saved';
  onDailyNote: () => void;
}

export function Toolbar({ saveStatus, onDailyNote }: Props) {
  const str = t.value.toolbar;
  const edStr = t.value.editor;

  const statusText =
    isReadOnly.value ? edStr.readOnly :
    saveStatus === 'dirty' ? edStr.unsaved :
    saveStatus === 'saving' ? edStr.saving :
    saveStatus === 'saved' ? edStr.saved : '';

  const statusClass =
    saveStatus === 'dirty' ? 'dirty' :
    saveStatus === 'saving' ? 'saving' :
    saveStatus === 'saved' ? 'saved' : '';

  const vaultName = vault.value?.name || '';
  const filePath = currentFilePath.value || '';
  const parts = filePath.split('/').filter(Boolean);

  return (
    <div class="toolbar">
      <div class="toolbar-left">
        <button
          class={`toolbar-btn${sidebarOpen.value ? ' active' : ''}`}
          title={str.toggleSidebar}
          onClick={() => { sidebarOpen.value = !sidebarOpen.value; }}
        >&#9776;</button>
        <div class="breadcrumb">
          <span>{vaultName}</span>
          {parts.map((part, i) => (
            <span key={i}>
              <span>/</span>
              <span style={i === parts.length - 1 ? 'color: var(--text-primary)' : ''}>
                {part.replace(/\.md$/, '')}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div class="toolbar-center">
        {currentFilePath.value && (
          <>
            <div class="view-mode-group">
              {(['edit', 'split', 'preview'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  class={`view-mode-btn${viewMode.value === mode ? ' active' : ''}`}
                  onClick={() => { viewMode.value = mode; }}
                >
                  {str[`view${mode.charAt(0).toUpperCase() + mode.slice(1)}` as keyof typeof str]}
                </button>
              ))}
            </div>
            {statusText && <span class={`save-status ${statusClass}`}>{statusText}</span>}
          </>
        )}
      </div>

      <div class="toolbar-right">
        <button class="toolbar-btn" title={str.dailyNote} onClick={onDailyNote}>&#128197;</button>
        <button class="toolbar-btn" title={str.toggleGraph} onClick={() => { graphOpen.value = true; }}>&#9673;</button>
        <button
          class={`toolbar-btn${backlinksOpen.value ? ' active' : ''}`}
          title={str.toggleBacklinks}
          onClick={() => { backlinksOpen.value = !backlinksOpen.value; }}
        >&#128279;</button>
        <SyncStatus />
        <button class="toolbar-btn" title={str.settings} onClick={() => { settingsOpen.value = true; }}>&#9881;</button>
        <button
          class="toolbar-btn"
          title={theme.value === 'dark' ? str.themeLight : str.themeDark}
          onClick={toggleTheme}
        >{theme.value === 'dark' ? '\u2600' : '\uD83C\uDF19'}</button>
      </div>
    </div>
  );
}
