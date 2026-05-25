import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, getDB, getNote, putNote, deleteNote, listNotes, listConflicts, resolveConflict, restoreNote, purgeNote, listTrash, sweepTrash, atomicRename } from '../../src/lib/db';
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
