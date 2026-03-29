import { settings, updateSettings, settingsOpen } from '../lib/store';
import { t } from '../i18n';
import { currentLang, setLang, supportedLangs, langLabels } from '../i18n/index';

export function SettingsPanel() {
  const str = t.value.settings;
  const s = settings.value;

  return (
    <div class="search-overlay" onClick={(e) => {
      if ((e.target as HTMLElement).classList.contains('search-overlay')) settingsOpen.value = false;
    }}>
      <div class="settings-dialog">
        <div class="settings-header">
          <h3>{str.title}</h3>
          <button class="toolbar-btn" onClick={() => { settingsOpen.value = false; }}>×</button>
        </div>

        <div class="settings-body">
          <div class="settings-row">
            <label>{str.fontSize}</label>
            <div class="settings-control">
              <button class="btn-secondary" onClick={() => updateSettings({ fontSize: Math.max(10, s.fontSize - 1) })}>-</button>
              <span class="settings-value">{s.fontSize}px</span>
              <button class="btn-secondary" onClick={() => updateSettings({ fontSize: Math.min(24, s.fontSize + 1) })}>+</button>
            </div>
          </div>

          <div class="settings-row">
            <label>{str.sortBy}</label>
            <div class="settings-control">
              <button
                class={`btn-secondary${s.sortBy === 'name' ? ' active' : ''}`}
                onClick={() => updateSettings({ sortBy: 'name' })}
              >{str.sortName}</button>
              <button
                class={`btn-secondary${s.sortBy === 'modified' ? ' active' : ''}`}
                onClick={() => updateSettings({ sortBy: 'modified' })}
              >{str.sortModified}</button>
            </div>
          </div>

          <div class="settings-row">
            <label>{str.lineNumbers}</label>
            <div class="settings-control">
              <button
                class={`btn-secondary toggle${s.editorLineNumbers ? ' active' : ''}`}
                onClick={() => updateSettings({ editorLineNumbers: !s.editorLineNumbers })}
              >
                {s.editorLineNumbers ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <div class="settings-row">
            <label>{str.language}</label>
            <div class="settings-control">
              <select
                class="settings-select"
                value={currentLang.value}
                onChange={(e) => setLang((e.target as HTMLSelectElement).value)}
              >
                {supportedLangs.map((lang) => (
                  <option key={lang} value={lang}>{langLabels[lang]}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
