import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, getDB, putNote, listConflicts } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { startSync, stopSync, isSyncing, __setRemoteFactory } from '../../src/lib/sync';
import { syncState } from '../../src/lib/store';

beforeEach(() => {
  setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>);
  __setRemoteFactory(() => freshDB('remote') as unknown as PouchDB.Database<NoteDoc>);
  syncState.value = { status: 'offline' };
});

afterEach(() => {
  stopSync();
  __setRemoteFactory(null);
});

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
