import PouchDB from 'pouchdb-browser';
import { getDB, listConflicts, resolveConflict, type NoteDoc } from './db';
import { syncState, type SyncStatus } from './store';
import { toast } from './toast';
import { t, tf } from '../i18n';

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
        toast.warning(left.length === 1 ? t.value.msg.conflictUnresolvedOne : tf(t.value.msg.conflictUnresolvedMany, { n: left.length }));
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

// A connection that stops answering (captive portal, dead NAT entry, a proxy that went away) left
// the push at "Syncing…" and the pull at "Synced" for as long as the OS kept the socket open.
// Every request gets a deadline: to the first byte, and between chunks after that — a slow link
// that keeps delivering is never cut. The long poll is asked to answer within LONGPOLL_MS (no
// heartbeat: a deadline must not depend on single bytes passing a compressing proxy).
const LONGPOLL_MS = 25_000;
const NET = { first: 60_000, idle: 60_000, slack: 30_000, uploadBytesPerSec: 20_000 };
const net = { ...NET, longpoll: LONGPOLL_MS };

/** Test hook: shorten the request deadlines. */
export function __setNetTiming(n: Partial<typeof net> | null): void {
  Object.assign(net, NET, { longpoll: LONGPOLL_MS }, n ?? {});
}

type FetchFn = (url: string | Request, opts?: RequestInit) => Promise<Response>;

export async function fetchWithDeadline(doFetch: FetchFn, url: string | Request, opts: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const outer = opts.signal;
  if (outer?.aborted) ctl.abort();
  else outer?.addEventListener('abort', () => ctl.abort(), { once: true });
  const longpoll = /[?&]feed=longpoll/.test(typeof url === 'string' ? url : url.url);
  const bodyLen = typeof opts.body === 'string' ? opts.body.length : 0;
  const first = longpoll ? net.longpoll + net.slack : net.first + (bodyLen / net.uploadBytesPerSec) * 1000;
  const idle = longpoll ? net.longpoll + net.slack : net.idle;
  let timer = setTimeout(() => ctl.abort(), first);
  try {
    const res = await doFetch(url, { ...opts, signal: ctl.signal });
    const reader = res.body?.getReader();
    if (!reader) return res;
    const chunks: Uint8Array[] = [];
    for (;;) {
      clearTimeout(timer);
      timer = setTimeout(() => ctl.abort(), idle);
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const empty = res.status === 204 || res.status === 205 || res.status === 304;
    const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) { body.set(c, at); at += c.length; }
    return new Response(empty ? null : body, { status: res.status, statusText: res.statusText, headers: res.headers });
  } finally {
    clearTimeout(timer);
  }
}

// Notes left out of the upload (see skip below), remembered as id → revision so the next session
// does not upload them again just to be refused again.
const SKIPPED_NAME = 'lokl-sync-skipped';

function readSkipped(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SKIPPED_NAME) || '{}') || {}; } catch { return {}; }
}
function writeSkipped(map: Record<string, string>): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(SKIPPED_NAME);
    else localStorage.setItem(SKIPPED_NAME, JSON.stringify(map));
  } catch { /* not remembered: the next session finds out again */ }
}
function forgetSkipped(id: string): void {
  const map = readSkipped();
  if (id in map) { delete map[id]; writeSkipped(map); }
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
  skipLoaded: boolean;
  // A big note being sent on its own, to learn whether it or the batch was over the limit.
  probe: { id: string; rev: string } | null;
  // Big notes that went through on their own — not probed again until edited.
  fits: Set<string>;
  force: boolean;
}

// One function for every filtered push: PouchDB derives the replication id (and with it the
// checkpoint) from the filter's source text, so the set of skipped notes can change without
// starting a new replication each time.
function notSkipped(doc: { _id: string }): boolean {
  return !session?.skip.has(doc._id);
}

let session: Session | null = null;
let quotaWarned = false;
let pullRestarts = 0;
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
  const m = t.value.msg;
  if (e?.status === 413 && e.code === 'STORAGE_LIMIT') return m.syncStorageFull;
  if (e?.status === 413) return m.noteTooLarge;
  if (e?.status === 401) return m.sessionExpired;
  if (e?.status === 403 && e.code === 'NO_SUBSCRIPTION') return m.subscriptionEnded;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return m.offlineRetry;
  return m.syncFailedRetry;
}

// A network failure or 5xx must not read as synced — that would stamp lastSynced while nothing
// is reaching the server.
export function onPaused(err?: unknown): void {
  if (err || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    const msg = describeSyncError(err);
    // The status dot is easy to miss; a full sync quota means edits stop leaving this device,
    // so say it once — not once per retry (the state passes through 'syncing' in between).
    const e = err as SyncError;
    if (e?.status === 413 && e.code === 'STORAGE_LIMIT' && !quotaWarned) { quotaWarned = true; toast.error(msg); }
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
  if (!s.force && s.pending.size === 0 && !s.probe) { recompute(s); return; }
  s.pushing = true;
  const probing = s.probe;
  const catchUp = s.lastPushEnd === 0 && s.pending.size === 0;
  // A probe carries one note; everything else is still unsent.
  if (!probing) { s.force = false; s.pending = new Set(); }
  recompute(s);
  try {
    if (!s.skipLoaded) { s.skipLoaded = true; await loadSkipped(s); }
    if (s.cancelled) return;
    const opts: PouchDB.Replication.ReplicateOptions = { batch_size: s.batchSize };
    if (probing) Object.assign(opts, { doc_ids: [probing.id], batch_size: 1, checkpoint: false });
    else if (s.skip.size > 0) opts.filter = notSkipped;
    const rep = s.local.replicate.to(s.remote, opts);
    s.pushRep = rep;
    const res = await rep;
    if (s.cancelled) return;
    s.pushing = false;
    s.pushErr = null;
    s.pushFails = 0;
    if (probing) {
      // It fits on its own: the batch was the problem. Send the rest.
      s.probe = null;
      s.fits.add(probing.id);
      s.force = true;
      schedulePush(s, 0);
    } else {
      // The catch-up at start usually sends nothing; pacing from it would hold the first edit back
      // for a whole interval. Every later round paces, sent or not (a second tab's rounds are
      // mostly empty — the first tab got there first — and must not run on the short debounce).
      if (!catchUp || (res?.docs_written ?? 0) > 0) s.lastPushEnd = Date.now();
      if (s.pending.size > 0) schedulePush(s, Math.max(timing.debounce, s.lastPushEnd + timing.interval - Date.now()));
    }
  } catch (err) {
    if (s.cancelled) return;
    s.pushing = false;
    s.force = true; // whatever this run carried is still unsent
    const e = err as SyncError;
    const tooLarge = e?.status === 413 && e.code === 'REQUEST_TOO_LARGE';
    let next: { id: string; rev: string } | null = null;
    if (tooLarge && probing) {
      // The note alone is over the request limit: name it once and leave it out, so the notes
      // behind it are not held back with it. Editing the note puts it back in.
      s.probe = null;
      s.skip.add(probing.id);
      writeSkipped({ ...readSkipped(), [probing.id]: probing.rev });
      toast.error(tf(t.value.msg.noteTooLargeNamed, { name: probing.id }));
      schedulePush(s, 0);
    } else if (tooLarge && (next = await largestUntried(s))) {
      // Try the biggest note on its own before shrinking the batch: halving down to one note at a
      // time sent an oversized note eight times before it was told apart from an oversized batch.
      s.probe = next;
      schedulePush(s, 0);
    } else if (tooLarge && s.batchSize > 1) {
      // The batch, not a note, was over the request limit. Smaller batches get through, and the
      // ones that do move the checkpoint.
      s.batchSize = Math.ceil(s.batchSize / 2);
      schedulePush(s, 0);
    } else {
      s.pushErr = err;
      noteFailure(s, err);
      schedulePush(s, backoff(s.pushFails++));
    }
  }
  recompute(s);
}

/** The biggest note that could by itself be over the request limit and has not been tried alone. */
async function largestUntried(s: Session): Promise<{ id: string; rev: string } | null> {
  try {
    const all = await s.local.allDocs({ include_docs: true });
    let worst: { id: string; rev: string; size: number } | null = null;
    for (const r of all.rows) {
      const content = (r.doc as NoteDoc | undefined)?.content ?? '';
      // length is a lower bound on bytes; only encode the candidates.
      if (s.skip.has(r.id) || s.fits.has(r.id) || content.length * 3 < timing.skipBytes) continue;
      const size = new TextEncoder().encode(content).length;
      if (size > (worst?.size ?? 0)) worst = { id: r.id, rev: r.value.rev, size };
    }
    // No note that big: the cause is something else — shrink the batch or keep the ordinary error.
    if (s.cancelled || !worst || worst.size < timing.skipBytes) return null;
    return { id: worst.id, rev: worst.rev };
  } catch { return null; }
}

/** Notes an earlier session found too large, if they are still at that revision. */
async function loadSkipped(s: Session): Promise<void> {
  const map = readSkipped();
  const ids = Object.keys(map);
  if (ids.length === 0) return;
  const still: Record<string, string> = {};
  try {
    const res = await s.local.allDocs({ keys: ids });
    for (const r of res.rows as Array<{ id?: string; value?: { rev: string; deleted?: boolean } }>) {
      if (!r.id || !r.value || r.value.deleted || r.value.rev !== map[r.id]) continue;
      still[r.id] = map[r.id];
      s.skip.add(r.id);
      toast.error(tf(t.value.msg.noteTooLargeNamed, { name: r.id }));
    }
  } catch { return; }
  writeSkipped(still);
}

export function startSync(): void {
  stopSync();

  const local = getDB();
  const remote = remoteFactoryOverride
    ? remoteFactoryOverride()
    : new PouchDB<NoteDoc>(`${API_URL}/lokl/db`, {
        fetch(url, opts) {
          return fetchWithDeadline(PouchDB.fetch as FetchFn, url, { ...opts, credentials: 'include' });
        },
      });

  const s: Session = {
    cancelled: false, local, remote,
    pullPaused: false, pullErr: null, pullFails: 0,
    pushing: false, pushErr: null, pushFails: 0, pushTimer: null, lastPushEnd: 0,
    batchSize: PUSH_BATCH, pending: new Set(), pulled: new Set(), skip: new Set(), skipLoaded: false,
    probe: null, fits: new Set(), force: true,
  };
  session = s;
  updateSyncState('syncing');

  s.pull = local.replicate.from(remote, {
    live: true,
    retry: true,
    // The server answers an idle long poll after this long, so a request that outlives it is dead.
    heartbeat: false,
    timeout: net.longpoll,
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
      if (err) noteFailure(s, err); else { s.pullFails = 0; pullRestarts = 0; }
      recompute(s);
    })
    .on('active', () => { s.pullPaused = false; s.pullErr = null; recompute(s); })
    .on('denied', (err) => { console.error('Sync denied:', err); })
    .on('error', (err) => {
      console.error('Sync error:', err);
      s.pullPaused = true;
      s.pullErr = err ?? new Error('sync stopped');
      if (err) noteFailure(s, err);
      recompute(s);
      // retry:true covers what PouchDB considers transient. Anything else ends the pull for good,
      // and nothing else would start it again — the state said "error" until a reload.
      setTimeout(() => { if (s === session) startSync(); }, backoff(pullRestarts++));
    });

  s.feed = local.changes({ since: 'now', live: true })
    .on('change', (c) => {
      const key = `${c.id}@${c.changes[0]?.rev}`;
      if (s.pulled.delete(key)) return; // the pull wrote this one
      // edited: it may fit now
      if (s.skip.delete(c.id)) forgetSkipped(c.id);
      s.fits.delete(c.id);
      if (s.probe?.id === c.id) s.probe = null;
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
