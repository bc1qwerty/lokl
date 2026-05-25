import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, getNote, putNote, deleteNote, listNotes } from '../../src/lib/db';
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
