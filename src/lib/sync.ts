import PouchDB from 'pouchdb-browser';
import { getDB, listConflicts, resolveConflict, type NoteDoc } from './db';
import { syncState, type SyncStatus } from './store';
import { toast } from './toast';

let conflictResolverRunning = false;
let conflictResolverPending = false;
// One warning per stretch of unresolved conflicts, not one per sync change.
let unresolvedWarned = false;

export async function resolveAllConflicts(): Promise<void> {
  if (conflictResolverRunning) {
    conflictResolverPending = true;
    return;
  }
  conflictResolverRunning = true;
  try {
    // A branch that keeps answering 404/409 must not spin this loop forever; the next
    // change event starts a fresh pass anyway.
    let contested = 0;
    let gaveUp = false;
    do {
      conflictResolverPending = false;
      const conflicts = await listConflicts();
      for (const c of conflicts) {
        // One note failing must not abandon the rest (and the pending re-run with them).
        // 404/409 = another device or tab settled the same branch first — look again.
        try {
          await resolveConflict(c._id);
        } catch (e: any) {
          if (e?.status === 404 || e?.status === 409) { if (++contested <= 5) conflictResolverPending = true; else gaveUp = true; }
          else { gaveUp = true; console.error('Conflict resolve failed:', c._id, e); }
        }
      }
    } while (conflictResolverPending);
    // What could not be settled stays in the database as a hidden losing revision — nothing in the
    // tree or the conflict panel shows it. Say so once; the next sync change or app start retries.
    if (gaveUp) {
      const left = await listConflicts().catch(() => []);
      if (left.length > 0 && !unresolvedWarned) {
        unresolvedWarned = true;
        toast.warning(`${left.length} sync conflict${left.length === 1 ? '' : 's'} could not be resolved yet — the other version is kept and will be retried.`);
      }
    } else {
      unresolvedWarned = false;
    }
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

/** What a replication error means for the user. */
export function describeSyncError(err: unknown): string {
  const e = err as { status?: number; code?: string } | null | undefined;
  if (e?.status === 413 && e.code === 'STORAGE_LIMIT') return 'Sync storage full (50MB) — delete notes to resume';
  if (e?.status === 413) return 'A note is too large to sync';
  if (e?.status === 401) return 'Session expired';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'Offline — will retry';
  return 'Sync failed — will retry';
}

// With retry:true a network failure or 5xx arrives as paused(err), not as
// 'error' — reporting it as synced would stamp lastSynced while nothing is
// reaching the server.
export function onPaused(err?: unknown): void {
  if (err || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    const msg = describeSyncError(err);
    // The status dot is easy to miss; a full sync quota means edits stop
    // leaving this device, so say it once when it starts.
    if (msg.startsWith('Sync storage full') && syncState.value.error !== msg) toast.error(msg);
    updateSyncState('error', msg);
  } else {
    updateSyncState('synced');
  }
}

// db.sync() re-emits 'paused' WITHOUT the error (pouchdb-browser 9: `this.emit('paused')`);
// the error only reaches the listeners of the push/pull replications underneath.
// So the state is derived from those two, not from the sync-level event.
interface Direction { paused: boolean; err: unknown }
type Replication = { on(event: string, cb: (arg?: unknown) => void): unknown };

function watchDirections(handler: unknown): void {
  const { push, pull } = handler as { push?: Replication; pull?: Replication };
  if (!push || !pull) return;
  const dirs: Record<'push' | 'pull', Direction> = {
    push: { paused: false, err: null },
    pull: { paused: false, err: null },
  };
  const recompute = () => {
    if (handler !== syncHandler) return; // a cancelled sync must not move the state
    const err = dirs.push.err ?? dirs.pull.err;
    if (err) onPaused(err);
    else if (dirs.push.paused && dirs.pull.paused) onPaused();
    else updateSyncState('syncing');
  };
  for (const [name, rep] of [['push', push], ['pull', pull]] as const) {
    rep.on('paused', (err) => { dirs[name] = { paused: true, err: err ?? null }; recompute(); });
    rep.on('active', () => { dirs[name] = { paused: false, err: null }; recompute(); });
  }
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

  const handler = localDB.sync(remoteDB, {
    live: true,
    retry: true,
  })
    .on('change', () => {
      resolveAllConflicts().catch(err => console.error('Conflict resolve failed:', err));
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
  syncHandler = handler;
  watchDirections(handler);
  // Conflicts left by an earlier session (tab closed right after a pull, the retry cap) were only
  // looked at again on the next sync change — which may never come.
  resolveAllConflicts().catch(err => console.error('Conflict resolve failed:', err));
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
