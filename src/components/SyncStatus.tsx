import { syncState, authState } from '../lib/store';

export function SyncStatus() {
  const auth = authState.value;
  const sync = syncState.value;

  if (auth.status !== 'authenticated') return null;

  const color =
    sync.status === 'synced' ? '#22c55e' :
    sync.status === 'syncing' ? '#f59e0b' :
    sync.status === 'error' ? '#ef4444' :
    'var(--text-muted)';

  const label =
    sync.status === 'synced' ? 'Synced' :
    sync.status === 'syncing' ? 'Syncing...' :
    sync.status === 'error' ? (sync.error || 'Error') :
    'Offline';

  return (
    <span
      class="sync-status"
      title={sync.lastSynced ? `Last synced: ${sync.lastSynced.toLocaleTimeString()}` : label}
      style="display:inline-flex; align-items:center; gap:4px; font-size:11px; color:var(--text-muted); padding:0 8px"
    >
      <span style={`width:6px; height:6px; border-radius:50%; background:${color}; display:inline-block`} />
      {label}
    </span>
  );
}
