import { settings, updateSettings, settingsOpen, authState, syncState } from '../lib/store';
import { getUser, openLogin } from '../lib/auth';
import { SubscriptionPanel } from './SubscriptionPanel';
import { t, tf } from '../i18n';
import { currentLang, setLang, supportedLangs, langLabels } from '../i18n/index';
import { exportJSON, exportZIP, importJSON } from '../lib/backup';
import { listTrash, purgeTrashed } from '../lib/db';
import { wakeSync } from '../lib/sync';
import { toast } from '../lib/toast';
import { settleOpenNote } from '../lib/autosave';
import { isNativeSupported } from '../lib/migrate';
import { importFromFSAA, announceImport } from '../lib/migrate';
import { useSignal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { useDialog } from '../lib/dialog';

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
  const m = t.value.msg;
  const s = settings.value;
  const folderImport = useSignal('');   // progress text while a folder import runs
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef);

  // A failed export (the zip chunk not arriving, storage refusing to read) used to end without a word.
  async function exportAs(kind: 'json' | 'zip') {
    try {
      // Land what is still in the editor first — the last second of typing was missing from backups.
      await settleOpenNote();
      const blob = kind === 'json' ? await exportJSON() : await exportZIP();
      download(blob, `lokl-backup-${new Date().toISOString().slice(0, 10)}.${kind}`);
    } catch (err: any) {
      console.error('Export failed:', err);
      toast.error(tf(m.exportFailed, { error: err?.message ?? m.unknownError }));
    }
  }

  // Also the way to finish an import that was interrupted: notes already in the
  // vault are skipped, differing ones are kept as conflict copies.
  async function importFolder() {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      folderImport.value = m.importing;
      const report = await importFromFSAA(handle, (current, total) => {
        folderImport.value = tf(m.importingProgress, { current, total });
      });
      announceImport(report);
    } catch (err: any) {
      if (err?.name !== 'AbortError') toast.error(tf(m.importFailed, { error: err?.message ?? m.unknownError }));
    } finally {
      folderImport.value = '';
    }
  }

  return (
    <div class="search-overlay" onClick={(e) => {
      if ((e.target as HTMLElement).classList.contains('search-overlay')) settingsOpen.value = false;
    }}>
      <div class="settings-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label={str.title}>
        <div class="settings-header">
          <h3>{str.title}</h3>
          <button class="toolbar-btn" aria-label={t.value.common.close} title={t.value.common.close} onClick={() => { settingsOpen.value = false; }}>×</button>
        </div>

        <div class="settings-body">
          <div class="settings-row">
            <span class="settings-label" id="set-font">{str.fontSize}</span>
            <div class="settings-control" role="group" aria-labelledby="set-font">
              <button class="btn-secondary" aria-label={`${str.fontSize} −`} onClick={() => updateSettings({ fontSize: Math.max(10, s.fontSize - 1) })}>-</button>
              <span class="settings-value">{s.fontSize}px</span>
              <button class="btn-secondary" aria-label={`${str.fontSize} +`} onClick={() => updateSettings({ fontSize: Math.min(24, s.fontSize + 1) })}>+</button>
            </div>
          </div>

          <div class="settings-row">
            <span class="settings-label" id="set-sort">{str.sortBy}</span>
            <div class="settings-control" role="group" aria-labelledby="set-sort">
              <button
                class={`btn-secondary${s.sortBy === 'name' ? ' active' : ''}`}
                aria-pressed={s.sortBy === 'name'}
                onClick={() => updateSettings({ sortBy: 'name' })}
              >{str.sortName}</button>
              <button
                class={`btn-secondary${s.sortBy === 'modified' ? ' active' : ''}`}
                aria-pressed={s.sortBy === 'modified'}
                onClick={() => updateSettings({ sortBy: 'modified' })}
              >{str.sortModified}</button>
            </div>
          </div>

          <div class="settings-row">
            <span class="settings-label" id="set-lines">{str.lineNumbers}</span>
            <div class="settings-control">
              <button
                class={`btn-secondary toggle${s.editorLineNumbers ? ' active' : ''}`}
                aria-labelledby="set-lines"
                aria-pressed={s.editorLineNumbers}
                onClick={() => updateSettings({ editorLineNumbers: !s.editorLineNumbers })}
              >
                {s.editorLineNumbers ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          <div class="settings-row">
            <label for="set-lang">{str.language}</label>
            <div class="settings-control">
              <select
                id="set-lang"
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
            <span class="settings-label" id="set-account">{m.account}</span>
            <div class="settings-control" role="group" aria-labelledby="set-account" style="flex-direction:column; align-items:flex-end; gap:4px">
              {authState.value.status === 'authenticated' ? (
                <>
                  <span style="font-size:12px; color:var(--text-primary)">
                    {authState.value.pubkey?.slice(0, 8)}...{authState.value.pubkey?.slice(-4)}
                  </span>
                  <span style="font-size:11px; color:var(--text-muted)">{m.loggedIn}</span>
                </>
              ) : (
                <button class="btn-primary" style="font-size:12px; padding:4px 12px" onClick={() => { settingsOpen.value = false; openLogin(); }}>
                  {m.loginLightning}
                </button>
              )}
            </div>
          </div>

          <div class="settings-row" style="flex-direction:column; align-items:stretch">
            <span class="settings-label">{m.sync}</span>
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
                    {syncState.value.status === 'synced' ? m.synced :
                     syncState.value.status === 'syncing' ? m.syncing :
                     syncState.value.status === 'error' ? (syncState.value.error || m.syncError) :
                     m.notSyncing}
                  </span>
                  {syncState.value.lastSynced && (
                    <span style="font-size:11px; color:var(--text-muted)">
                      {syncState.value.lastSynced.toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <span style="font-size:12px; color:var(--text-muted)">{m.loginToSync}</span>
            )}
          </div>

          <div class="settings-divider" style="border-top:1px solid var(--border); margin:12px 0" />

          <div class="settings-row" style="flex-direction:column; align-items:stretch; gap:6px">
            <span class="settings-label" style="font-size:13px; color:var(--text-secondary); margin-bottom:4px">{str.data.title}</span>

            <button class="btn-secondary" onClick={() => exportAs('json')}>{str.data.exportJson}</button>

            <button class="btn-secondary" onClick={() => exportAs('zip')}>{str.data.exportZip}</button>

            <label class="settings-import-label">
              {str.data.importJson}
              <input type="file" accept=".json" onChange={async (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (!f) return;
                try {
                  const { imported, conflicts } = await importJSON(f);
                  toast.success(tf(m.importedJson, { imported, conflicts }));
                } catch (err: any) {
                  toast.error(tf(m.importFailed, { error: err?.message ?? m.unknownError }));
                }
                (e.target as HTMLInputElement).value = '';
              }} />
            </label>

            {isNativeSupported() && (
              <button class="btn-secondary settings-import-folder" disabled={!!folderImport.value} onClick={importFolder}>
                {folderImport.value || m.importFromFolder}
              </button>
            )}

            <button class="btn-secondary" onClick={async () => {
              const trashed = await listTrash();
              if (trashed.length === 0) {
                toast.info(str.data.trashEmpty);
                return;
              }
              if (!confirm(str.data.emptyTrashConfirm.replace('{n}', String(trashed.length)))) return;
              let purged = 0, failed = 0;
              for (const n of trashed) {
                // The list was read before the confirm dialog — a note restored since then is live and must stay.
                try { if ((await purgeTrashed(n._id)) === 'done') purged++; } catch (err) {
                  console.warn(`purgeTrashed failed for ${n._id}:`, err);
                  failed++;
                }
              }
              if (purged) wakeSync();
              if (failed) toast.error(tf(m.couldNotDelete, { failed, total: trashed.length }));
              toast.success(t.value.settings.data.purgedCount.replace('{n}', String(purged)));
            }}>{str.data.emptyTrash}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
