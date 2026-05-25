import { settings, updateSettings, settingsOpen, authState, syncState } from '../lib/store';
import { getUser, openLogin } from '../lib/auth';
import { startSync, stopSync } from '../lib/sync';
import { SubscriptionPanel } from './SubscriptionPanel';
import { t } from '../i18n';
import { currentLang, setLang, supportedLangs, langLabels } from '../i18n/index';
import { exportJSON, exportZIP, importJSON } from '../lib/backup';
import { listTrash, purgeNote } from '../lib/db';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

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

          <div class="settings-divider" style="border-top:1px solid var(--border); margin:12px 0" />

          <div class="settings-row">
            <label>Account</label>
            <div class="settings-control" style="flex-direction:column; align-items:flex-end; gap:4px">
              {authState.value.status === 'authenticated' ? (
                <>
                  <span style="font-size:12px; color:var(--text-primary)">
                    {authState.value.pubkey?.slice(0, 8)}...{authState.value.pubkey?.slice(-4)}
                  </span>
                  <span style="font-size:11px; color:var(--text-muted)">Logged in</span>
                </>
              ) : (
                <button class="btn-primary" style="font-size:12px; padding:4px 12px" onClick={() => { settingsOpen.value = false; openLogin(); }}>
                  Login with Lightning
                </button>
              )}
            </div>
          </div>

          <div class="settings-row" style="flex-direction:column; align-items:stretch">
            <label>Sync</label>
            {authState.value.status === 'authenticated' ? (
              <>
                <SubscriptionPanel />
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px">
                  <span style={{
                    fontSize: '11px',
                    color: syncState.value.status === 'synced' ? '#22c55e' :
                           syncState.value.status === 'syncing' ? '#f59e0b' :
                           syncState.value.status === 'error' ? '#ef4444' : 'var(--text-muted)'
                  }}>
                    {syncState.value.status === 'synced' ? 'Synced' :
                     syncState.value.status === 'syncing' ? 'Syncing...' :
                     syncState.value.status === 'error' ? (syncState.value.error || 'Error') :
                     'Not syncing'}
                  </span>
                  {syncState.value.lastSynced && (
                    <span style="font-size:11px; color:var(--text-muted)">
                      {syncState.value.lastSynced.toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <span style="font-size:12px; color:var(--text-muted)">Login to enable sync</span>
            )}
          </div>

          <div class="settings-divider" style="border-top:1px solid var(--border); margin:12px 0" />

          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:6px">
            <label style="font-size:13px; color:var(--text-secondary); margin-bottom:4px">{str.data.title}</label>

            <button class="btn-secondary" onClick={async () => {
              const blob = await exportJSON();
              download(blob, `lokl-backup-${new Date().toISOString().slice(0, 10)}.json`);
            }}>{str.data.exportJson}</button>

            <button class="btn-secondary" onClick={async () => {
              const blob = await exportZIP();
              download(blob, `lokl-backup-${new Date().toISOString().slice(0, 10)}.zip`);
            }}>{str.data.exportZip}</button>

            <label class="settings-import-label">
              {str.data.importJson}
              <input type="file" accept=".json" onChange={async (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (!f) return;
                try {
                  const { imported, conflicts } = await importJSON(f);
                  alert(`Imported ${imported}. Conflicts kept: ${conflicts}.`);
                } catch (err: any) {
                  alert(`Import failed: ${err?.message ?? 'unknown error'}`);
                }
                (e.target as HTMLInputElement).value = '';
              }} />
            </label>

            <button class="btn-secondary" onClick={async () => {
              const trashed = await listTrash();
              if (trashed.length === 0) {
                alert(str.data.trashEmpty);
                return;
              }
              if (!confirm(str.data.emptyTrashConfirm.replace('{n}', String(trashed.length)))) return;
              let purged = 0;
              for (const n of trashed) {
                try { await purgeNote(n._id); purged++; } catch {}
              }
              alert(`Purged ${purged}.`);
            }}>{str.data.emptyTrash}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
