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

// Pull stays live. Push is ours: PouchDB's live push sends every local save on its own
// (8 proxy requests per autosave once the echo comes back), and its retry backoff is reset by
// every 'active' — a write the server keeps refusing (quota, oversized batch) was re-uploaded
// every second, forever.
const PUSH_BATCH = 100;
const BACKOFF_MAX_MS = 5 * 60_000;
const SUB_RECHECK_MS = 60_000;
// skipBytes: a note this big can by itself be over the proxy's 16MB request limit once JSON-escaped.
const TIMING = { debounce: 2000, interval: 15_000, backoffBase: 1000, skipBytes: 8 * 1024 * 1024 };
const timing = { ...TIMING };

/** Test hook: shorten the push pacing. */
export function __setSyncTiming(t: Partial<typeof timing> | null): void {
  Object.assign(timing, TIMING, t ?? {});
}

interface Session {
  cancelled: boolean;
  local: PouchDB.Database<NoteDoc>;
  remote: PouchDB.Database<NoteDoc>;
  pull?: { cancel(): void };
  feed?: { cancel(): void };
  pushRep?: { cancel(): void };
  pullPaused: boolean;
  pullErr: unknown;
  pullFails: number;
  pushing: boolean;
  pushErr: unknown;
  pushFails: number;
  pushTimer: ReturnType<typeof setTimeout> | null;
  lastPushEnd: number;
  batchSize: number;
  // Local revisions not yet offered to the server. What the pull itself wrote is taken back out,
  // so an incoming change does not cost a push round of its own.
  pending: Set<string>;
  // Revisions the pull wrote whose change-feed event has not arrived yet (it comes after the
  // pull's own 'change'), so the feed can tell them from local edits.
  pulled: Set<string>;
  // Notes that alone exceed the request limit. Left out so the rest still uploads.
  skip: Set<string>;
  force: boolean;
}

let session: Session | null = null;
let quotaWarned = false;
const TOO_LARGE = { status: 413 };
let subscriptionLost: (() => void) | null = null;
let subLostAt = 0;

/** Called when the server says, mid-session, that the subscription is gone. */
export function onSubscriptionLost(cb: (() => void) | null): void {
  subscriptionLost = cb;
}

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

type SyncError = { status?: number; code?: string } | null | undefined;

/** What a replication error means for the user. */
export function describeSyncError(err: unknown): string {
  const e = err as SyncError;
  // Deleting a note only moves it to the trash — the server still holds the whole text.
  if (e?.status === 413 && e.code === 'STORAGE_LIMIT') return 'Sync storage full (50MB) — delete notes and empty the trash to resume';
  if (e?.status === 413) return 'A note is too large to sync';
  if (e?.status === 401) return 'Session expired';
  if (e?.status === 403 && e.code === 'NO_SUBSCRIPTION') return 'Sync subscription ended';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'Offline — will retry';
  return 'Sync failed — will retry';
}

// A network failure or 5xx must not read as synced — that would stamp lastSynced while nothing
// is reaching the server.
export function onPaused(err?: unknown): void {
  if (err || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    const msg = describeSyncError(err);
    // The status dot is easy to miss; a full sync quota means edits stop leaving this device,
    // so say it once — not once per retry (the state passes through 'syncing' in between).
    if (msg.startsWith('Sync storage full') && !quotaWarned) { quotaWarned = true; toast.error(msg); }
    updateSyncState('error', msg);
  } else {
    quotaWarned = false;
    updateSyncState('synced');
  }
}

function recompute(s: Session): void {
  if (s !== session) return; // a cancelled sync must not move the state
  // A skipped note is not synced, whatever else went through.
  const err = s.pushErr ?? s.pullErr ?? (s.skip.size > 0 ? TOO_LARGE : null);
  if (err) onPaused(err);
  else if (s.pullPaused && !s.pushing && !s.force && s.pending.size === 0) onPaused();
  else updateSyncState('syncing');
}

function backoff(fails: number): number {
  return Math.min(BACKOFF_MAX_MS, timing.backoffBase * 2 ** Math.min(fails, 20));
}

function noteFailure(s: Session, err: unknown): void {
  const e = err as SyncError;
  if (e?.status !== 403 || e.code !== 'NO_SUBSCRIPTION') return;
  // The controller re-checks and stops the sync. Not on every retry: if the two endpoints
  // disagree that would restart the sync in a loop.
  if (Date.now() - subLostAt < SUB_RECHECK_MS) return;
  subLostAt = Date.now();
  if (s === session) subscriptionLost?.();
}

function schedulePush(s: Session, delay: number): void {
  if (s.cancelled) return;
  if (s.pushTimer) clearTimeout(s.pushTimer);
  s.pushTimer = setTimeout(() => { s.pushTimer = null; void runPush(s); }, delay);
}

async function runPush(s: Session): Promise<void> {
  if (s.cancelled || s.pushing) return;
  if (!s.force && s.pending.size === 0) { recompute(s); return; }
  s.pushing = true;
  const catchUp = s.lastPushEnd === 0 && s.pending.size === 0;
  s.force = false;
  s.pending = new Set();
  recompute(s);
  try {
    const opts: PouchDB.Replication.ReplicateOptions = { batch_size: s.batchSize };
    if (s.skip.size > 0) {
      const all = await s.local.changes({ since: 0 });
      opts.doc_ids = all.results.map(r => r.id).filter(id => !s.skip.has(id));
    }
    const rep = s.local.replicate.to(s.remote, opts);
    s.pushRep = rep;
    const res = await rep;
    if (s.cancelled) return;
    s.pushing = false;
    s.pushErr = null;
    s.pushFails = 0;
    // The catch-up at start usually sends nothing; pacing from it would hold the first edit back
    // for a whole interval. Every later round paces, sent or not (a second tab's rounds are
    // mostly empty — the first tab got there first — and must not run on the short debounce).
    if (!catchUp || (res?.docs_written ?? 0) > 0) s.lastPushEnd = Date.now();
    if (s.pending.size > 0) schedulePush(s, Math.max(timing.debounce, s.lastPushEnd + timing.interval - Date.now()));
  } catch (err) {
    if (s.cancelled) return;
    s.pushing = false;
    s.force = true; // whatever this run carried is still unsent
    const e = err as SyncError;
    if (e?.status === 413 && e.code === 'REQUEST_TOO_LARGE' && s.batchSize > 1) {
      // The batch, not a note, was over the request limit. Smaller batches get through, and the
      // ones that do move the checkpoint.
      s.batchSize = Math.ceil(s.batchSize / 2);
      schedulePush(s, 0);
    } else if (e?.status === 413 && e.code === 'REQUEST_TOO_LARGE' && await skipLargest(s)) {
      schedulePush(s, 0);
    } else {
      s.pushErr = err;
      noteFailure(s, err);
      schedulePush(s, backoff(s.pushFails++));
    }
  }
  recompute(s);
}

/** One note alone is over the request limit: name it once and leave it out, so the notes
 *  behind it are not held back with it. Editing the note puts it back in. */
async function skipLargest(s: Session): Promise<boolean> {
  try {
    const all = await s.local.allDocs({ include_docs: true });
    let worst: { id: string; size: number } | null = null;
    for (const r of all.rows) {
      const content = (r.doc as NoteDoc | undefined)?.content ?? '';
      // length is a lower bound on bytes; only encode the candidates.
      if (s.skip.has(r.id) || content.length * 3 < timing.skipBytes) continue;
      const size = new TextEncoder().encode(content).length;
      if (size > (worst?.size ?? 0)) worst = { id: r.id, size };
    }
    // No note that big: the cause is something else — keep the ordinary error and backoff.
    if (s.cancelled || !worst || worst.size < timing.skipBytes) return false;
    s.skip.add(worst.id);
    toast.error(`"${worst.id}" is too large to sync — it stays on this device. Shorten or split it to sync it again.`);
    return true;
  } catch { return false; }
}

export function startSync(): void {
  stopSync();

  const local = getDB();
  const remote = remoteFactoryOverride
    ? remoteFactoryOverride()
    : new PouchDB<NoteDoc>(`${API_URL}/lokl/db`, {
        fetch(url, opts) {
          (opts as any).credentials = 'include';
          return PouchDB.fetch(url, opts);
        },
      });

  const s: Session = {
    cancelled: false, local, remote,
    pullPaused: false, pullErr: null, pullFails: 0,
    pushing: false, pushErr: null, pushFails: 0, pushTimer: null, lastPushEnd: 0,
    batchSize: PUSH_BATCH, pending: new Set(), pulled: new Set(), skip: new Set(), force: true,
  };
  session = s;
  updateSyncState('syncing');

  s.pull = local.replicate.from(remote, {
    live: true,
    retry: true,
    // PouchDB hands in its own delay, which it resets on every 'active'. Count ourselves.
    back_off_function: () => backoff(s.pullFails++),
  })
    .on('change', (info) => {
      s.pullFails = 0;
      if (s.pulled.size > 5000) s.pulled.clear();
      for (const d of info.docs ?? []) {
        const key = `${d._id}@${(d as { _rev?: string })._rev}`;
        if (!s.pending.delete(key)) s.pulled.add(key);
      }
      resolveAllConflicts().catch(err => console.error('Conflict resolve failed:', err));
      recompute(s);
    })
    .on('paused', (err: unknown) => {
      s.pullPaused = true;
      s.pullErr = err ?? null;
      if (err) noteFailure(s, err); else s.pullFails = 0;
      recompute(s);
    })
    .on('active', () => { s.pullPaused = false; s.pullErr = null; recompute(s); })
    .on('denied', (err) => { console.error('Sync denied:', err); })
    .on('error', (err) => {
      console.error('Sync error:', err);
      s.pullPaused = true;
      s.pullErr = err ?? new Error('sync stopped');
      recompute(s);
    });

  s.feed = local.changes({ since: 'now', live: true })
    .on('change', (c) => {
      const key = `${c.id}@${c.changes[0]?.rev}`;
      if (s.pulled.delete(key)) return; // the pull wrote this one
      s.skip.delete(c.id); // edited: it may fit now
      s.pending.add(key);
      // Already waiting (pacing or backoff) or running: this change rides along. Re-arming here
      // would let steady typing postpone the push forever.
      if (s.pushing || s.pushTimer) { recompute(s); return; }
      schedulePush(s, Math.max(timing.debounce, s.lastPushEnd + timing.interval - Date.now()));
      recompute(s);
    })
    .on('error', (err) => { console.error('Change feed for sync failed:', err); });

  // Catch up on whatever was written while sync was off.
  schedulePush(s, 0);
  // Conflicts left by an earlier session (tab closed right after a pull, the retry cap) were only
  // looked at again on the next sync change — which may never come.
  resolveAllConflicts().catch(err => console.error('Conflict resolve failed:', err));
}

export function stopSync(): void {
  const s = session;
  if (s) {
    s.cancelled = true;
    session = null;
    if (s.pushTimer) clearTimeout(s.pushTimer);
    s.pull?.cancel();
    s.feed?.cancel();
    s.pushRep?.cancel();
  }
  updateSyncState('offline');
}

export function isSyncing(): boolean {
  return session !== null;
}

/** Retry now instead of waiting out a backoff — after the user freed sync space. */
export function wakeSync(): void {
  if (session && (session.pushErr || session.pullErr)) startSync();
}
