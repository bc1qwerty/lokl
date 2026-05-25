import PouchDB from 'pouchdb-browser';
import { getDB, listConflicts, resolveConflict, type NoteDoc } from './db';
import { syncState, type SyncStatus } from './store';

let conflictResolverRunning = false;
let conflictResolverPending = false;

async function resolveAllConflicts(): Promise<void> {
  if (conflictResolverRunning) {
    conflictResolverPending = true;
    return;
  }
  conflictResolverRunning = true;
  try {
    do {
      conflictResolverPending = false;
      const conflicts = await listConflicts();
      for (const c of conflicts) {
        await resolveConflict(c._id);
      }
    } while (conflictResolverPending);
  } finally {
    conflictResolverRunning = false;
  }
}

const API_URL = import.meta.env.VITE_API_URL || 'https://api.txid.uk';

let syncHandler: PouchDB.Replication.Sync<NoteDoc> | null = null;

let remoteFactoryOverride: (() => PouchDB.Database<NoteDoc>) | null = null;

export function __setRemoteFactory(f: (() => PouchDB.Database<NoteDoc>) | null): void {
  remoteFactoryOverride = f;
}

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
  const remoteDB = remoteFactoryOverride
    ? remoteFactoryOverride()
    : new PouchDB<NoteDoc>(`${API_URL}/lokl/db`, {
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
      resolveAllConflicts().catch(err => console.error('Conflict resolve failed:', err));
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
