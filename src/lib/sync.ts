import PouchDB from 'pouchdb-browser';
import { getDB, type NoteDoc } from './db';
import { syncState, type SyncStatus } from './store';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.txid.uk';

let syncHandler: PouchDB.Replication.Sync<NoteDoc> | null = null;

function updateSyncState(status: SyncStatus, error?: string) {
  syncState.value = {
    status,
    lastSynced: status === 'synced' ? new Date() : syncState.value.lastSynced,
    error,
  };
}

export function startSync(): void {
  stopSync();

  const localDB = getDB();
  const remoteDB = new PouchDB<NoteDoc>(`${API_URL}/lokl/db`, {
    fetch(url, opts) {
      (opts as any).credentials = 'include';
      return PouchDB.fetch(url, opts);
    },
  });

  updateSyncState('syncing');

  syncHandler = localDB.sync(remoteDB, {
    live: true,
    retry: true,
  })
    .on('change', () => {
      updateSyncState('syncing');
    })
    .on('paused', () => {
      updateSyncState('synced');
    })
    .on('active', () => {
      updateSyncState('syncing');
    })
    .on('denied', (err) => {
      console.error('Sync denied:', err);
      updateSyncState('error', 'Access denied');
    })
    .on('error', (err) => {
      console.error('Sync error:', err);
      const msg = (err as any)?.status === 401 ? 'Session expired' : 'Sync failed';
      updateSyncState('error', msg);
    }) as unknown as PouchDB.Replication.Sync<NoteDoc>;
}

export function stopSync(): void {
  if (syncHandler) {
    syncHandler.cancel();
    syncHandler = null;
  }
  updateSyncState('offline');
}

export function isSyncing(): boolean {
  return syncHandler !== null;
}
