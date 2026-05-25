import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB } from '../../src/lib/db';
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
