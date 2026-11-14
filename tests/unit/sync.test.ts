import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, getDB, putNote, listConflicts } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { startSync, stopSync, isSyncing, onPaused, wakeSync, onSubscriptionLost, describeSyncError, fetchWithDeadline, __setNetTiming, __setRemoteFactory, __setSyncTiming } from '../../src/lib/sync';
import { toasts } from '../../src/lib/toast';
import { syncState } from '../../src/lib/store';

beforeEach(() => {
  setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>);
  __setRemoteFactory(() => freshDB('remote') as unknown as PouchDB.Database<NoteDoc>);
  syncState.value = { status: 'offline' };
  toasts.value = [];
  __setSyncTiming({ debounce: 20, interval: 150, backoffBase: 20 });
});

afterEach(() => {
  stopSync();
  localStorage.removeItem('lokl-sync-skipped');
  __setNetTiming(null);
  __setRemoteFactory(null);
  onSubscriptionLost(null);
  __setSyncTiming(null);
});

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(cond: () => boolean | Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await wait(15);
  }
  throw new Error(`condition not met; state=${JSON.stringify(syncState.value)}`);
}
function countingRemote(name: string, reject?: (docs: unknown[]) => unknown) {
  const remoteDB = freshDB(name) as unknown as PouchDB.Database<NoteDoc>;
  const real = remoteDB.bulkDocs.bind(remoteDB);
  const calls: number[] = [];
  (remoteDB as any).bulkDocs = (req: any, ...rest: unknown[]) => {
    const docs = Array.isArray(req) ? req : req.docs;
    // the conflict resolver and the replication checkpoint do not go through here with notes
    calls.push(docs.length);
    const err = reject?.(docs);
    return err ? Promise.reject(err) : (real as any)(req, ...rest);
  };
  __setRemoteFactory(() => remoteDB);
  return { remoteDB, calls };
}

describe('sync state machine', () => {
  it('starts in offline state', () => {
    expect(syncState.value.status).toBe('offline');
    expect(isSyncing()).toBe(false);
  });

  it('startSync flips to syncing or synced', async () => {
    startSync();
    // Wait briefly for PouchDB sync to emit a state event
    await new Promise(r => setTimeout(r, 50));
    expect(['syncing', 'synced']).toContain(syncState.value.status);
    expect(isSyncing()).toBe(true);
  });

  it('stopSync returns to offline', async () => {
    startSync();
    await new Promise(r => setTimeout(r, 50));
    stopSync();
    expect(syncState.value.status).toBe('offline');
    expect(isSyncing()).toBe(false);
  });

  it('replicates a doc from local to remote', async () => {
    let remoteDB!: PouchDB.Database<NoteDoc>;
    __setRemoteFactory(() => {
      remoteDB = freshDB('remote-repl') as unknown as PouchDB.Database<NoteDoc>;
      return remoteDB;
    });
    const { putNote } = await import('../../src/lib/db');
    await putNote('s.md', '# Hello');
    startSync();
    // Wait for replication
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 50));
      try {
        const doc = await remoteDB.get('s.md');
        if ((doc as any).content === '# Hello') break;
      } catch { /* not yet */ }
    }
    const doc = await remoteDB.get('s.md');
    expect((doc as any).content).toBe('# Hello');
  });
});

describe('sync auto-resolves conflicts', () => {
  it('keeps both versions after a sync introduces a conflict', async () => {
    // Create remote DB eagerly so we can seed it before startSync
    const remoteDB = freshDB('remote-conflict') as unknown as PouchDB.Database<NoteDoc>;
    __setRemoteFactory(() => remoteDB);

    // Seed both DBs with competing versions of the same id
    await putNote('s.md', 'local');
    await remoteDB.bulkDocs([{
      _id: 's.md',
      _rev: '1-aabbccddeeff00112233445566778899',
      content: 'remote',
      title: 's',
      tags: [],
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any], { new_edits: false });

    startSync();

    // Poll until a conflict-sibling appears in the raw DB (bypasses listNotes filter)
    let found = false;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 100));
      const all = await getDB().allDocs({ include_docs: true });
      const docs = all.rows.map(r => r.doc).filter(Boolean) as Array<any>;
      if (docs.some(d => typeof d._id === 'string' && d._id.includes('(conflict-') && d.conflictOf === 's.md')) {
        found = true;
        break;
      }
    }

    stopSync();
    expect(found).toBe(true);
    expect(await listConflicts()).toEqual([]);
  });
});

describe('paused with an error is not "synced"', () => {
  it('paused(err) reports an error and does not stamp lastSynced', () => {
    onPaused(new Error('Failed to fetch'));
    expect(syncState.value.status).toBe('error');
    expect(syncState.value.lastSynced).toBeUndefined();
  });

  it('paused() without an error is synced', () => {
    onPaused();
    expect(syncState.value.status).toBe('synced');
    expect(syncState.value.lastSynced).toBeInstanceOf(Date);
  });
});

// The unit test above calls onPaused directly, which is how a dead wire went
// unnoticed: db.sync() re-emits 'paused' without the error, so the handler on
// the sync object never saw one and every outage read as "Synced".
describe('a failing replication reaches the sync state through the real events', () => {
  async function until(cond: () => boolean, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (cond()) return;
      await new Promise(r => setTimeout(r, 20));
    }
    throw new Error(`condition not met; state=${JSON.stringify(syncState.value)}`);
  }

  it('a rejected push shows an error and never stamps lastSynced', async () => {
    const remoteDB = freshDB('remote-fail') as unknown as PouchDB.Database<NoteDoc>;
    (remoteDB as any).bulkDocs = () => Promise.reject({ status: 500, name: 'unknown', message: 'boom' });
    __setRemoteFactory(() => remoteDB);
    await putNote('f.md', 'cannot leave');
    startSync();
    await until(() => syncState.value.status === 'error');
    expect(syncState.value.error).toBe('Sync failed — will retry');
    expect(syncState.value.lastSynced).toBeUndefined();
  });

  it('the 50MB limit (413 STORAGE_LIMIT) is named, not shown as a generic failure', async () => {
    const remoteDB = freshDB('remote-full') as unknown as PouchDB.Database<NoteDoc>;
    (remoteDB as any).bulkDocs = () =>
      Promise.reject({ status: 413, name: 'too_large', code: 'STORAGE_LIMIT', message: 'Storage limit reached (50MB).' });
    __setRemoteFactory(() => remoteDB);
    await putNote('g.md', 'over quota');
    startSync();
    await until(() => syncState.value.status === 'error');
    expect(syncState.value.error).toMatch(/storage full/i);
  });

  it('recovers to synced once the remote accepts writes again', async () => {
    const remoteDB = freshDB('remote-recover') as unknown as PouchDB.Database<NoteDoc>;
    const real = remoteDB.bulkDocs.bind(remoteDB);
    let fail = true;
    (remoteDB as any).bulkDocs = (...a: unknown[]) =>
      fail ? Promise.reject({ status: 503, name: 'unknown', message: 'down' }) : (real as any)(...a);
    __setRemoteFactory(() => remoteDB);
    await putNote('h.md', 'later');
    startSync();
    await until(() => syncState.value.status === 'error');
    fail = false;
    await until(() => syncState.value.status === 'synced', 15000);
    expect(((await remoteDB.get('h.md')) as any).content).toBe('later');
  }, 20000);

  it('a clean sync still ends up synced', async () => {
    await putNote('i.md', 'fine');
    startSync();
    await until(() => syncState.value.status === 'synced');
    expect(syncState.value.lastSynced).toBeInstanceOf(Date);
  });
});

// 2026-11-14: live push sent every save on its own, retried a refused write about once a second
// for good (PouchDB resets its backoff on every 'active'), and stacked one sticky toast per retry.
describe('push pacing, backoff and refused writes', () => {

  it('a burst of saves leaves in one push, not one per save', async () => {
    const { remoteDB, calls } = countingRemote('remote-burst');
    startSync();
    await until(() => syncState.value.status === 'synced');
    const before = calls.length;
    for (let i = 0; i < 8; i++) { await putNote('burst.md', `v${i}`); await wait(10); }
    expect(syncState.value.status).toBe('syncing'); // unsent edits are not "Synced"
    await until(async () => (await remoteDB.get('burst.md').catch(() => null) as any)?.content === 'v7');
    await until(() => syncState.value.status === 'synced');
    expect(calls.length - before).toBeLessThanOrEqual(2);
  });

  it('steady saving does not postpone the push forever', async () => {
    const { remoteDB } = countingRemote('remote-steady');
    startSync();
    await until(() => syncState.value.status === 'synced');
    let stop = false;
    const typing = (async () => { for (let i = 0; !stop; i++) { await putNote('steady.md', `s${i}`); await wait(10); } })();
    try {
      await until(async () => !!(await remoteDB.get('steady.md').catch(() => null)), 2000);
    } finally { stop = true; await typing; }
  });

  it('a full sync quota: one toast, retries back off, local saves do not shorten the wait', async () => {
    const { calls } = countingRemote('remote-quota', () => ({ status: 413, name: 'too_large', code: 'STORAGE_LIMIT', message: 'full' }));
    await putNote('q.md', 'over');
    startSync();
    await until(() => syncState.value.status === 'error');
    for (let i = 0; i < 10; i++) { await putNote('q.md', `more ${i}`); await wait(60); }
    // 20ms doubling: 20+40+80+160+320 = 620ms for five retries. The old loop made dozens.
    expect(calls.length).toBeLessThanOrEqual(7);
    expect(toasts.value.filter(t => /storage full/i.test(t.message))).toHaveLength(1);
    expect(syncState.value.error).toMatch(/empty the trash/);
  });

  it('wakeSync retries at once after space was freed', async () => {
    let full = true;
    const { remoteDB } = countingRemote('remote-wake', () => (full ? { status: 413, name: 'too_large', code: 'STORAGE_LIMIT', message: 'full' } : null));
    __setSyncTiming({ debounce: 20, interval: 150, backoffBase: 60_000 });
    await putNote('w.md', 'waiting');
    startSync();
    await until(() => syncState.value.status === 'error');
    full = false;
    await wait(100);
    expect(syncState.value.status).toBe('error'); // still waiting out the backoff
    wakeSync();
    await until(() => syncState.value.status === 'synced');
    expect(((await remoteDB.get('w.md')) as any).content).toBe('waiting');
  });

  it('a batch over the request limit is split until it fits', async () => {
    const { remoteDB, calls } = countingRemote('remote-big', (docs) =>
      (docs.length > 3 ? { status: 413, name: 'too_large', code: 'REQUEST_TOO_LARGE', message: 'big' } : null));
    for (let i = 0; i < 10; i++) await putNote(`b${i}.md`, `body ${i}`);
    startSync();
    await until(() => syncState.value.status === 'synced');
    expect((await remoteDB.allDocs()).rows).toHaveLength(10);
    expect(Math.max(...calls.filter(n => n <= 3))).toBeLessThanOrEqual(3);
    expect(toasts.value).toHaveLength(0);
  });

  it('only a single note that does not fit is called too large', async () => {
    countingRemote('remote-huge', () => ({ status: 413, name: 'too_large', code: 'REQUEST_TOO_LARGE', message: 'big' }));
    await putNote('huge.md', 'x');
    startSync();
    await until(() => syncState.value.status === 'error');
    expect(syncState.value.error).toBe('A note is too large to sync');
  });

  it('a note over the limit is named and left out; the notes behind it still upload', async () => {
    __setSyncTiming({ debounce: 20, interval: 150, backoffBase: 20, skipBytes: 500 });
    const tooBig = (docs: any[]) => docs.some(d => (d.content?.length ?? 0) > 500);
    const { remoteDB } = countingRemote('remote-skip', (docs) =>
      (tooBig(docs as any[]) ? { status: 413, name: 'too_large', code: 'REQUEST_TOO_LARGE', message: 'big' } : null));
    await putNote('a.md', 'small a');
    await putNote('giant.md', 'x'.repeat(2000));
    await putNote('z.md', 'small z');
    startSync();
    await until(async () => (await remoteDB.allDocs()).rows.length === 2);
    await until(() => syncState.value.status === 'error');
    expect(syncState.value.error).toBe('A note is too large to sync'); // never "Synced" with a note left behind
    expect(toasts.value.filter(t => /giant\.md/.test(t.message))).toHaveLength(1);
    // later edits to other notes keep flowing
    await putNote('z.md', 'small z2');
    await until(async () => (await remoteDB.get('z.md') as any).content === 'small z2');
    expect(toasts.value.filter(t => /giant\.md/.test(t.message))).toHaveLength(1);
    // shortened: it goes up and the state clears
    await putNote('giant.md', 'short now');
    await until(async () => (await remoteDB.get('giant.md').catch(() => null) as any)?.content === 'short now');
    await until(() => syncState.value.status === 'synced');
  });

  it('a pulled change does not cost a push round of its own', async () => {
    const { remoteDB } = countingRemote('remote-pullonly');
    // every push round asks the server what it is missing, whether or not anything is sent
    let diffs = 0;
    const realDiff = remoteDB.revsDiff.bind(remoteDB);
    (remoteDB as any).revsDiff = (...a: unknown[]) => { diffs++; return (realDiff as any)(...a); };
    startSync();
    await until(() => syncState.value.status === 'synced');
    await wait(100);
    const before = diffs;
    for (let i = 0; i < 5; i++) { await remoteDB.put({ _id: `in${i}.md`, content: `from elsewhere ${i}`, mtime: Date.now() } as any); await wait(30); }
    await until(async () => (await getDB().allDocs()).rows.length === 5);
    await wait(400); // well past debounce and interval
    expect(diffs).toBe(before);
    expect(syncState.value.status).toBe('synced');
  });

  it('the first edit after start leaves after the debounce, not a whole interval later', async () => {
    __setSyncTiming({ debounce: 20, interval: 3000, backoffBase: 20 });
    const { remoteDB } = countingRemote('remote-first');
    startSync();
    await until(() => syncState.value.status === 'synced');
    await putNote('first.md', 'hello');
    await until(async () => !!(await remoteDB.get('first.md').catch(() => null)), 1000);
  });

  it('a lapsed subscription is named and reported once, not per retry', async () => {
    countingRemote('remote-lapsed', () => ({ status: 403, name: 'forbidden', code: 'NO_SUBSCRIPTION', message: 'Subscription required' }));
    let lost = 0;
    onSubscriptionLost(() => { lost++; });
    await putNote('l.md', 'x');
    startSync();
    await until(() => syncState.value.status === 'error');
    await wait(300); // several retries
    expect(syncState.value.error).toBe('Sync subscription ended');
    expect(lost).toBeLessThanOrEqual(1);
    expect(describeSyncError({ status: 403 })).toBe('Sync failed — will retry');
  });
  it('an oversized note is uploaded twice at most, not once per halving', async () => {
    __setSyncTiming({ debounce: 20, interval: 150, backoffBase: 20, skipBytes: 500 });
    let giantUploads = 0;
    const { remoteDB } = countingRemote('remote-probe', (docs) => {
      const big = (docs as any[]).some(d => (d.content?.length ?? 0) > 500);
      if (big) giantUploads++;
      return big ? { status: 413, name: 'too_large', code: 'REQUEST_TOO_LARGE', message: 'big' } : null;
    });
    for (let i = 0; i < 40; i++) await putNote(`n${i}.md`, `small ${i}`);
    await putNote('giant.md', 'x'.repeat(2000));
    startSync();
    await until(async () => (await remoteDB.allDocs()).rows.length === 40);
    await until(() => syncState.value.status === 'error');
    expect(giantUploads).toBe(2); // once in the batch, once alone — it was 8 with the batch halved down to 1
    // the next session knows already: the note is not sent again
    stopSync();
    startSync();
    await until(() => syncState.value.error === 'A note is too large to sync');
    await putNote('n0.md', 'small again');
    await until(async () => (await remoteDB.get('n0.md') as any).content === 'small again');
    expect(giantUploads).toBe(2);
    // edited: forgotten, tried again
    await putNote('giant.md', 'short now');
    await until(async () => (await remoteDB.get('giant.md').catch(() => null) as any)?.content === 'short now');
    expect(localStorage.getItem('lokl-sync-skipped')).toBeNull();
  });

  it('a big note that fits on its own is not left out when the batch was the problem', async () => {
    __setSyncTiming({ debounce: 20, interval: 150, backoffBase: 20, skipBytes: 500 });
    const { remoteDB } = countingRemote('remote-fits', (docs) =>
      ((docs as any[]).reduce((n, d) => n + (d.content?.length ?? 0), 0) > 1500 ? { status: 413, name: 'too_large', code: 'REQUEST_TOO_LARGE', message: 'big' } : null));
    await putNote('big1.md', 'a'.repeat(1000));
    await putNote('big2.md', 'b'.repeat(1000));
    await putNote('s.md', 'small');
    startSync();
    await until(async () => (await remoteDB.allDocs()).rows.length === 3);
    await until(() => syncState.value.status === 'synced');
    expect(toasts.value).toHaveLength(0);
  });
});

describe('request deadlines', () => {
  const hang = (_u: unknown, o?: RequestInit) => new Promise<Response>((_, rej) => {
    o?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
  });

  // 2026-11-14: the upload deadline was 60s + one second per 20,000 *characters*. A 6MB batch of
  // Korean notes on a 30KB/s uplink was cut at 160s every time and re-sent whole, forever.
  it('the upload deadline counts bytes, not characters', async () => {
    __setNetTiming({ first: 20, idle: 5000, slack: 10, longpoll: 30, uploadBytesPerSec: 10_000 });
    const after = (ms: number) => (_u: unknown, o?: RequestInit) => new Promise<Response>((res, rej) => {
      const timer = setTimeout(() => res(new Response('{}')), ms);
      o?.signal?.addEventListener('abort', () => { clearTimeout(timer); rej(new DOMException('aborted', 'AbortError')); });
    });
    // 1,000 Korean characters = 3,000 bytes → 20ms + 300ms. Counted as characters it was 120ms.
    const body = '가'.repeat(1000);
    await expect(fetchWithDeadline(after(200), 'https://x.test/db/_bulk_docs', { method: 'POST', body })).resolves.toBeTruthy();
  });

  it('an upload that does not fit its deadline is sent in smaller batches, not re-sent whole', async () => {
    __setNetTiming({ first: 15, idle: 5000, slack: 10, longpoll: 30, uploadBytesPerSec: 1e9 });
    const remoteDB = freshDB('remote-slowlink') as unknown as PouchDB.Database<NoteDoc>;
    const real = remoteDB.bulkDocs.bind(remoteDB);
    const sizes: number[] = [];
    (remoteDB as any).bulkDocs = async (req: any, ...rest: unknown[]) => {
      const docs = Array.isArray(req) ? req : req.docs;
      if (docs.some((d: any) => typeof d.content === 'string')) sizes.push(docs.length);
      if (docs.length > 3) {
        // what the real remote does on a link too slow for this much: the request's deadline runs out
        await fetchWithDeadline(hang, 'https://x.test/db/_bulk_docs', { method: 'POST', body: 'x' }).catch(() => undefined);
        throw { status: 0, name: 'unknown', message: 'aborted' };
      }
      return (real as any)(req, ...rest);
    };
    __setRemoteFactory(() => remoteDB);
    for (let i = 0; i < 12; i++) await putNote(`n${i}.md`, `note ${i}`);
    startSync();
    await until(async () => (await remoteDB.allDocs()).rows.length === 12, 8000);
    await until(() => syncState.value.status === 'synced');
    // batch size 100 → 50 → 25 → 13 → 7: the whole dozen goes at most five times, then less, and it ends
    expect(sizes.filter(n => n === 12).length).toBeLessThanOrEqual(5);
    expect(sizes[sizes.length - 1]).toBeLessThanOrEqual(3);
  });

  it('a single note too slow for its deadline is given longer, until it gets through', async () => {
    // deadline = 15ms + bytes × scale / 20,000 per second → 65, 115, 215ms… for a 1,000-byte body
    __setNetTiming({ first: 15, idle: 5000, slack: 10, longpoll: 30, uploadBytesPerSec: 20_000 });
    const remoteDB = freshDB('remote-slownote') as unknown as PouchDB.Database<NoteDoc>;
    const real = remoteDB.bulkDocs.bind(remoteDB);
    let tries = 0;
    const slow = (_u: unknown, o?: RequestInit) => new Promise<Response>((res, rej) => {
      const timer = setTimeout(() => res(new Response('{}')), 150);
      o?.signal?.addEventListener('abort', () => { clearTimeout(timer); rej(new DOMException('aborted', 'AbortError')); });
    });
    (remoteDB as any).bulkDocs = async (req: any, ...rest: unknown[]) => {
      const docs = Array.isArray(req) ? req : req.docs;
      if (docs.some((d: any) => typeof d.content === 'string')) {
        tries++;
        try { await fetchWithDeadline(slow, 'https://x.test/db/_bulk_docs', { method: 'POST', body: 'x'.repeat(1000) }); }
        catch { throw { status: 0, name: 'unknown', message: 'aborted' }; }
      }
      return (real as any)(req, ...rest);
    };
    __setRemoteFactory(() => remoteDB);
    await putNote('slow.md', 'takes a while');
    startSync();
    await until(async () => (await remoteDB.get('slow.md').catch(() => null)) !== null, 8000);
    expect(tries).toBeGreaterThan(1);
    expect(tries).toBeLessThan(6);
    await until(() => syncState.value.status === 'synced');
  });

  it('a skipped note is named once, however often the sync restarts', async () => {
    __setSyncTiming({ debounce: 20, interval: 150, backoffBase: 20, skipBytes: 500 });
    const tooBig = (docs: any[]) => docs.some(d => (d.content?.length ?? 0) > 500);
    countingRemote('remote-skip-once', (docs) =>
      (tooBig(docs as any[]) ? { status: 413, name: 'too_large', code: 'REQUEST_TOO_LARGE', message: 'big' } : null));
    await putNote('giant-once.md', 'x'.repeat(2000));
    startSync();
    await until(() => toasts.value.some(t => /giant-once\.md/.test(t.message)));
    for (let i = 0; i < 3; i++) { startSync(); await wait(150); }
    expect(toasts.value.filter(t => /giant-once\.md/.test(t.message))).toHaveLength(1);
  });

  it('a request that never answers is aborted', async () => {
    __setNetTiming({ first: 40, idle: 40, slack: 10, longpoll: 30 });
    const t0 = Date.now();
    await expect(fetchWithDeadline(hang, 'https://x.test/db/_bulk_docs', { method: 'POST', body: '{}' })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('a long poll gets its poll time plus slack', async () => {
    __setNetTiming({ first: 5000, idle: 5000, slack: 20, longpoll: 60 });
    const t0 = Date.now();
    await expect(fetchWithDeadline(hang, 'https://x.test/db/_changes?feed=longpoll&timeout=60')).rejects.toThrow();
    const took = Date.now() - t0;
    expect(took).toBeGreaterThanOrEqual(70);
    expect(took).toBeLessThan(1500);
  });

  it('a body that stops arriving is aborted; one that keeps arriving is not, however long it takes', async () => {
    __setNetTiming({ first: 200, idle: 60, slack: 10, longpoll: 30 });
    const streamed = (chunks: number, gap: number, stall = false) => (_u: unknown, o?: RequestInit) => Promise.resolve(new Response(new ReadableStream({
      async start(c) {
        o?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
        for (let i = 0; i < chunks; i++) { await new Promise(r => setTimeout(r, gap)); c.enqueue(new TextEncoder().encode('ab')); }
        if (!stall) c.close();
      },
    }), { status: 200 }));
    const ok = await fetchWithDeadline(streamed(10, 30), 'https://x.test/db/_bulk_get', { method: 'POST', body: '{}' });
    expect(await ok.text()).toBe('ab'.repeat(10)); // 300ms in all — past both deadlines, never idle for 60ms
    await expect(fetchWithDeadline(streamed(2, 10, true), 'https://x.test/db/_bulk_get', { method: 'POST', body: '{}' })).rejects.toThrow();
  });

  it("the caller's own abort still works", async () => {
    const ctl = new AbortController();
    const p = fetchWithDeadline(hang, 'https://x.test/db/', { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toThrow();
  });
});
