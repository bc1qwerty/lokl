import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, getDB, getNote, putNote, deleteNote, listNotes, listConflictSiblings, listConflicts, resolveConflict, restoreNote, purgeNote, purgeTrashed, restoreTrashed, listTrash, sweepTrash, atomicRename } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';

beforeEach(() => setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>));

describe('db basics', () => {
  it('puts and gets', async () => {
    await putNote('a.md', '# Hello');
    const n = await getNote('a.md');
    expect(n?.title).toBe('Hello');
    expect(n?.content).toBe('# Hello');
  });

  it('returns null for missing', async () => {
    expect(await getNote('missing.md')).toBeNull();
  });

  it('deleteNote moves to trash', async () => {
    await putNote('t.md', 'x');
    await deleteNote('t.md');
    expect(await getNote('t.md')).toBeNull();
    const raw = await getDB().get('t.md');
    expect((raw as any).trashed).toBe(true);
    expect(typeof (raw as any).trashedAt).toBe('string');
  });

  it('lists non-deleted', async () => {
    await putNote('a.md', 'A');
    await putNote('b.md', 'B');
    await deleteNote('a.md');
    const all = await listNotes();
    expect(all.map(n => n._id)).toEqual(['b.md']);
  });

  it('extracts tags and outgoing wikilinks', async () => {
    await putNote('a.md', '# T\n#foo [[b]]');
    const n = await getNote('a.md');
    expect(n?.tags).toContain('foo');
    expect(n?.links).toContain('b');
  });
});

describe('putNote race / 409 retry', () => {
  it('survives 20 concurrent writes to the same id', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => putNote('r.md', `v${i}`))
    );
    const n = await getNote('r.md');
    expect(n).not.toBeNull();
    expect(n!.content).toMatch(/^v\d+$/);
  });

  it('retries on 409 after a side-write changes _rev', async () => {
    await putNote('c.md', 'first');
    const stale = await getDB().get('c.md');
    await getDB().put({ ...stale, content: 'side-write' });
    // putNote should re-fetch the latest _rev and succeed
    await putNote('c.md', 'caller-write');
    const n = await getNote('c.md');
    expect(n!.content).toBe('caller-write');
  });
});

describe('conflict resolution', () => {
  it('listConflicts is empty when no conflicts exist', async () => {
    await putNote('a.md', 'A');
    expect(await listConflicts()).toEqual([]);
  });

  it('resolveConflict creates a sibling with conflictOf and removes the losing rev', async () => {
    await putNote('p.md', 'mine');
    const winningDoc = await getDB().get('p.md');
    // Force a competing rev — same _id, no _rev, new_edits:false
    await getDB().bulkDocs([{
      _id: 'p.md',
      _rev: '1-aabbccddeeff00112233445566778899',
      content: 'theirs',
      title: 'p',
      tags: [],
      links: [],
      createdAt: winningDoc.createdAt,
      updatedAt: new Date().toISOString(),
    } as any], { new_edits: false });

    const conflicts = await listConflicts();
    expect(conflicts.length).toBe(1);

    const siblingIds = await resolveConflict('p.md');
    expect(siblingIds.length).toBe(1);

    const sibling = await getNote(siblingIds[0]);
    expect(sibling).not.toBeNull();
    expect(sibling!.conflictOf).toBe('p.md');
    expect(['mine', 'theirs']).toContain(sibling!.content);

    // No remaining conflicts on p.md
    expect(await listConflicts()).toEqual([]);
  });

  it('disambiguates sibling ids when a doc has multiple conflicting revs', async () => {
    await putNote('q.md', 'mine');
    const winning = await getDB().get('q.md');
    // Two competing revs at the same level
    await getDB().bulkDocs([
      { _id: 'q.md', _rev: '1-a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', content: 'theirs-a', title: 'q', tags: [], links: [], createdAt: winning.createdAt, updatedAt: new Date().toISOString() } as any,
      { _id: 'q.md', _rev: '1-b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', content: 'theirs-b', title: 'q', tags: [], links: [], createdAt: winning.createdAt, updatedAt: new Date().toISOString() } as any,
    ], { new_edits: false });

    const conflicts = await listConflicts();
    expect(conflicts.length).toBe(1);

    const siblingIds = await resolveConflict('q.md');
    expect(siblingIds.length).toBe(2);
    expect(new Set(siblingIds).size).toBe(2);  // distinct
  });

  it('sibling id is deterministic (rev-based) so concurrent resolvers converge', async () => {
    await putNote('r.md', 'mine');
    await getDB().bulkDocs([{
      _id: 'r.md',
      _rev: '1-cccccccccccccccccccccccccccccccc',
      content: 'theirs',
      title: 'r',
      tags: [],
      links: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any], { new_edits: false });

    const winning = await getDB().get('r.md', { conflicts: true } as any) as any;
    const losingRev = winning._conflicts[0] as string;

    const siblingIds = await resolveConflict('r.md');
    // No local timestamp in the id — every client computes this exact id.
    expect(siblingIds).toEqual([`r (conflict-${losingRev}).md`]);
  });
});

describe('trash + sweeper', () => {
  it('restoreNote brings back to listNotes', async () => {
    await putNote('t.md', 'x');
    await deleteNote('t.md');
    await restoreNote('t.md');
    expect((await getNote('t.md'))?.content).toBe('x');
    const all = await listNotes();
    expect(all.map(n => n._id)).toContain('t.md');
  });

  it('purgeNote removes physically', async () => {
    await putNote('t.md', 'x');
    await deleteNote('t.md');
    await purgeNote('t.md');
    await expect(getDB().get('t.md')).rejects.toMatchObject({ status: 404 });
  });

  // The trash panel's list can be seconds old: the note may have been restored
  // (it is live again) or purged elsewhere since.
  it('purgeTrashed refuses a note that was restored since the list was read', async () => {
    await putNote('t.md', 'precious');
    await deleteNote('t.md');
    await restoreNote('t.md'); // another tab
    expect(await purgeTrashed('t.md')).toBe('not-trashed');
    expect((await getNote('t.md'))?.content).toBe('precious');
  });

  it('purgeTrashed and restoreTrashed report a note that is already gone instead of throwing', async () => {
    await putNote('t.md', 'x');
    await deleteNote('t.md');
    await purgeNote('t.md'); // another tab
    expect(await purgeTrashed('t.md')).toBe('gone');
    expect(await restoreTrashed('t.md')).toBe('gone');
    expect(await purgeTrashed('never-existed.md')).toBe('gone');
  });

  it('purgeTrashed removes real trash; restoreTrashed brings real trash back and leaves a live note alone', async () => {
    await putNote('a.md', 'A');
    await putNote('b.md', 'B');
    await deleteNote('a.md');
    await deleteNote('b.md');
    expect(await purgeTrashed('a.md')).toBe('done');
    await expect(getDB().get('a.md')).rejects.toMatchObject({ status: 404 });
    expect(await restoreTrashed('b.md')).toBe('done');
    const rev = (await getDB().get('b.md'))._rev;
    expect(await restoreTrashed('b.md')).toBe('not-trashed');
    expect((await getDB().get('b.md'))._rev).toBe(rev);
  });

  // One read: the removal is pinned to the revision whose `trashed` flag was
  // checked. Before, the flag was read, then the note was read again and removed —
  // a restore landing in between wiped a live note.
  it('purgeTrashed leaves a note that is restored between the check and the removal', async () => {
    await putNote('t.md', 'precious');
    await deleteNote('t.md');
    const db = getDB();
    const realGet = db.get.bind(db);
    let raced = false;
    (db as any).get = async (...args: any[]) => {
      const doc = await (realGet as any)(...args);
      if (!raced && args[0] === 't.md') { raced = true; await restoreNote('t.md'); } // another tab, right after our read
      return doc;
    };
    try {
      expect(await purgeTrashed('t.md')).toBe('not-trashed');
    } finally {
      (db as any).get = realGet;
    }
    expect((await getNote('t.md'))?.content).toBe('precious');
  });

  it('restoreTrashed does not undo a purge that landed between its check and its write', async () => {
    await putNote('t.md', 'x');
    await deleteNote('t.md');
    const db = getDB();
    const realGet = db.get.bind(db);
    let raced = false;
    (db as any).get = async (...args: any[]) => {
      const doc = await (realGet as any)(...args);
      if (!raced && args[0] === 't.md') { raced = true; await purgeNote('t.md'); }
      return doc;
    };
    try {
      expect(await restoreTrashed('t.md')).toBe('gone');
    } finally {
      (db as any).get = realGet;
    }
    await expect(getDB().get('t.md')).rejects.toMatchObject({ status: 404 });
  });

  it('listTrash returns only trashed docs', async () => {
    await putNote('a.md', 'A');
    await putNote('b.md', 'B');
    await deleteNote('a.md');
    const trash = await listTrash();
    expect(trash.map(n => n._id)).toEqual(['a.md']);
  });

  it('sweepTrash deletes notes older than 30 days', async () => {
    await putNote('old.md', 'x');
    const raw = await getDB().get('old.md');
    const oldDate = new Date(Date.now() - 31 * 86400000).toISOString();
    await getDB().put({ ...raw, trashed: true, trashedAt: oldDate });
    await sweepTrash();
    await expect(getDB().get('old.md')).rejects.toMatchObject({ status: 404 });
  });

  it('sweepTrash keeps notes within 30 days', async () => {
    await putNote('young.md', 'x');
    const raw = await getDB().get('young.md');
    const recent = new Date(Date.now() - 1 * 86400000).toISOString();
    await getDB().put({ ...raw, trashed: true, trashedAt: recent });
    await sweepTrash();
    const after = await getDB().get('young.md');
    expect((after as any).trashed).toBe(true);
  });

  it('sweepTrash migrates legacy `deleted: true` to trashed', async () => {
    const now = new Date().toISOString();
    await getDB().put({
      _id: 'legacy.md',
      deleted: true,
      content: '',
      title: 'legacy',
      tags: [],
      links: [],
      createdAt: now,
      updatedAt: now,
    } as any);
    await sweepTrash();
    const raw = await getDB().get('legacy.md');
    expect((raw as any).trashed).toBe(true);
    expect((raw as any).deleted).toBeUndefined();
  });

  it('listNotes excludes trashed AND conflictOf', async () => {
    await putNote('keep.md', 'k');
    await putNote('drop.md', 'd');
    await deleteNote('drop.md');
    await putNote('side.md', 's');
    const side = await getDB().get('side.md');
    await getDB().put({ ...side, conflictOf: 'keep.md' });
    const visible = await listNotes();
    expect(visible.map(n => n._id)).toEqual(['keep.md']);
  });
});

describe('atomicRename', () => {
  it('moves a note from old to new path', async () => {
    await putNote('old.md', 'content here');
    await atomicRename('old.md', 'new.md');
    expect(await getNote('old.md')).toBeNull();
    expect((await getNote('new.md'))?.content).toBe('content here');
  });

  it('rejects when destination already exists', async () => {
    await putNote('a.md', '1');
    await putNote('b.md', '2');
    await expect(atomicRename('a.md', 'b.md')).rejects.toThrow(/Destination exists/);
    // Both remain
    expect((await getNote('a.md'))?.content).toBe('1');
    expect((await getNote('b.md'))?.content).toBe('2');
  });

  it('rejects when source not found', async () => {
    await expect(atomicRename('nope.md', 'new.md')).rejects.toThrow(/Source not found/);
  });

  it('is a no-op when source equals destination', async () => {
    await putNote('same.md', 'x');
    await atomicRename('same.md', 'same.md');
    expect((await getNote('same.md'))?.content).toBe('x');
  });
});

describe('overwrite safety', () => {
  it('listConflictSiblings returns what listNotes hides', async () => {
    await putNote('keep.md', 'k');
    await putNote('side.md', 's');
    const side = await getDB().get('side.md');
    await getDB().put({ ...side, conflictOf: 'keep.md' });
    expect((await listNotes()).map(n => n._id)).toEqual(['keep.md']);
    expect((await listConflictSiblings()).map(n => n._id)).toEqual(['side.md']);
    await deleteNote('side.md');
    expect(await listConflictSiblings()).toEqual([]);
  });

  it('reusing the name of a trashed note keeps the trash copy', async () => {
    await putNote('todo.md', 'precious');
    await deleteNote('todo.md');
    await putNote('todo.md', '');
    expect((await getNote('todo.md'))?.content).toBe('');
    const trash = await listTrash();
    expect(trash.map(t => t.content)).toEqual(['precious']);
    expect(trash[0]._id).not.toBe('todo.md');
  });

  it('rename leaves nothing in the trash, and the old name can be reused', async () => {
    await putNote('a.md', 'v1');
    await atomicRename('a.md', 'b.md');
    expect(await listTrash()).toEqual([]);
    await putNote('b.md', 'v2');
    await atomicRename('b.md', 'a.md');
    expect((await getNote('a.md'))?.content).toBe('v2');
    expect(await getNote('b.md')).toBeNull();
    expect(await listTrash()).toEqual([]);
  });

  it('renaming onto a name that sits in the trash keeps the trash copy', async () => {
    await putNote('a.md', 'old');
    await deleteNote('a.md');
    await putNote('b.md', 'new');
    await atomicRename('b.md', 'a.md');
    expect((await getNote('a.md'))?.content).toBe('new');
    expect((await listTrash()).map(t => t.content)).toEqual(['old']);
  });

  it('rename keeps createdAt', async () => {
    await putNote('a.md', 'x');
    const created = (await getNote('a.md'))!.createdAt;
    await new Promise(r => setTimeout(r, 5));
    await atomicRename('a.md', 'b.md');
    expect((await getNote('b.md'))!.createdAt).toBe(created);
  });

  it('putNote returns the stored rev', async () => {
    const rev = await putNote('a.md', 'x');
    expect((await getDB().get('a.md'))._rev).toBe(rev);
  });
});

describe('atomicRename and conflict copies', () => {
  it('re-points conflict copies at the renamed note', async () => {
    await putNote('orig.md', 'body');
    await putNote('orig (conflict-1-abc).md', 'other body');
    const sib = await getDB().get('orig (conflict-1-abc).md');
    await getDB().put({ ...sib, conflictOf: 'orig.md' });
    await atomicRename('orig.md', 'renamed.md');
    const siblings = await listConflictSiblings();
    expect(siblings.map(s => s.conflictOf)).toEqual(['renamed.md']);
    expect(siblings[0].content).toBe('other body');
  });
});

// Two devices and a server, each its own database. Every device resolves the
// same conflict by itself; the results must be identical or the copies conflict
// with each other and multiply.
describe('conflict resolution converges across devices', () => {
  async function replicate(from: PouchDB.Database<NoteDoc>, to: PouchDB.Database<NoteDoc>) {
    await from.replicate.to(to);
    await to.replicate.to(from);
  }
  async function on<T>(db: PouchDB.Database<NoteDoc>, fn: () => Promise<T>): Promise<T> {
    setDB(db);
    return fn();
  }
  async function resolveAll(db: PouchDB.Database<NoteDoc>) {
    await on(db, async () => { for (const c of await listConflicts()) await resolveConflict(c._id); });
  }
  async function rows(db: PouchDB.Database<NoteDoc>) {
    const r = await db.allDocs({ include_docs: true, conflicts: true });
    return r.rows.map(x => x.doc as NoteDoc & { _conflicts?: string[] });
  }
  function three() {
    return [freshDB(), freshDB(), freshDB()] as unknown as PouchDB.Database<NoteDoc>[];
  }

  it('one conflict → one copy, the same on both devices, and it stays one', async () => {
    const [a, b, server] = three();
    await on(a, () => putNote('n.md', 'base'));
    await replicate(a, server); await replicate(b, server);
    await on(a, () => putNote('n.md', 'edit from A'));
    await on(b, () => putNote('n.md', 'edit from B'));
    // Both come online, both see the conflict, both resolve before hearing of the other.
    await replicate(a, server); await replicate(b, server); await replicate(a, server);
    await resolveAll(a); await resolveAll(b);
    for (let round = 0; round < 4; round++) {
      await replicate(a, server); await replicate(b, server);
      await resolveAll(a); await resolveAll(b);
    }
    await replicate(a, server); await replicate(b, server); await replicate(a, server);

    for (const db of [a, b, server]) {
      const all = await rows(db);
      expect(all.filter(d => d._conflicts?.length).map(d => d._id)).toEqual([]);
      const copies = all.filter(d => d.conflictOf);
      expect(copies.length).toBe(1);
      expect(copies[0].conflictOf).toBe('n.md');
      const texts = [copies[0].content, all.find(d => d._id === 'n.md')!.content].sort();
      expect(texts).toEqual(['edit from A', 'edit from B']);
    }
  });

  it('trash on one device vs an offline edit on the other: the edit is never hidden', async () => {
    const [a, b, server] = three();
    await on(a, () => putNote('t.md', 'base'));
    await replicate(a, server); await replicate(b, server);
    await on(a, () => deleteNote('t.md'));
    await on(b, () => putNote('t.md', 'offline edit'));
    await replicate(a, server); await replicate(b, server); await replicate(a, server);
    await resolveAll(a); await resolveAll(b);
    await replicate(a, server); await replicate(b, server);
    await resolveAll(a); await resolveAll(b);
    await replicate(a, server); await replicate(b, server); await replicate(a, server);

    for (const db of [a, b]) {
      const all = await rows(db);
      expect(all.filter(d => d._conflicts?.length)).toEqual([]);
      // Whichever revision won, the edit is reachable: as the note itself or as a conflict copy.
      const live = all.filter(d => !d.trashed && d.content === 'offline edit');
      expect(live.length).toBe(1);
    }
  });

  it('"Delete forever" on a note with a losing revision does not bring it back', async () => {
    const [a, b, server] = three();
    await on(a, () => putNote('z.md', 'base'));
    await replicate(a, server); await replicate(b, server);
    await on(a, () => deleteNote('z.md'));
    await on(b, () => putNote('z.md', 'offline edit'));
    await replicate(a, server); await replicate(b, server); await replicate(a, server);
    // Purge before any resolver ran: both leaves must go.
    await on(a, () => purgeNote('z.md'));
    await expect(a.get('z.md')).rejects.toMatchObject({ status: 404 });
    await replicate(a, server); await replicate(b, server);
    await expect(b.get('z.md')).rejects.toMatchObject({ status: 404 });
  });

  it('sweepTrash removes every revision of an expired note', async () => {
    const [a, b, server] = three();
    await on(a, () => putNote('s.md', 'base'));
    await replicate(a, server); await replicate(b, server);
    await on(a, async () => {
      const doc = await getDB().get('s.md');
      await getDB().put({ ...doc, trashed: true, trashedAt: new Date(Date.now() - 40 * 86400_000).toISOString() });
    });
    await on(b, async () => {
      const doc = await getDB().get('s.md');
      await getDB().put({ ...doc, trashed: true, trashedAt: new Date(Date.now() - 41 * 86400_000).toISOString(), content: 'other' });
    });
    await replicate(a, server); await replicate(b, server); await replicate(a, server);
    await on(a, () => sweepTrash());
    await expect(a.get('s.md')).rejects.toMatchObject({ status: 404 });
  });

  it('a losing revision with the same text leaves no copy behind', async () => {
    const [a, b, server] = three();
    await on(a, () => putNote('e.md', 'base'));
    await replicate(a, server); await replicate(b, server);
    await on(a, () => putNote('e.md', 'same words'));
    await new Promise(r => setTimeout(r, 5)); // different updatedAt → different rev
    await on(b, () => putNote('e.md', 'same words'));
    await replicate(a, server); await replicate(b, server); await replicate(a, server);
    await resolveAll(a);
    const all = await rows(a);
    expect(all.filter(d => d.conflictOf)).toEqual([]);
    expect(all.filter(d => d._conflicts?.length)).toEqual([]);
  });
});
