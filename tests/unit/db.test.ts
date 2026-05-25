import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, getDB, getNote, putNote, deleteNote, listNotes } from '../../src/lib/db';
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

  it('soft-deletes (current behavior — pre-trash refactor)', async () => {
    await putNote('a.md', 'x');
    await deleteNote('a.md');
    expect(await getNote('a.md')).toBeNull();
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
