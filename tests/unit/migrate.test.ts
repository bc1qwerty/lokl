import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { createMockDir, wrapAsFSAA } from '../helpers/mock-fsaa';
import { setDB, listNotes, putNote, getNote } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { importFromFSAA, exportToFSAA } from '../../src/lib/migrate';

beforeEach(() => setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>));

describe('migrate.importFromFSAA', () => {
  it('imports markdown files at top level', async () => {
    const dir = createMockDir();
    dir.children.set('a.md', { kind: 'file', name: 'a.md', content: '# Hello' } as any);
    dir.children.set('b.md', { kind: 'file', name: 'b.md', content: '# B' } as any);
    const count = await importFromFSAA(wrapAsFSAA(dir));
    expect(count).toBe(2);
    const notes = await listNotes();
    expect(notes.map(n => n._id).sort()).toEqual(['a.md', 'b.md']);
  });

  it('recurses into subdirectories', async () => {
    const dir = createMockDir();
    const sub = createMockDir('journal');
    sub.children.set('day.md', { kind: 'file', name: 'day.md', content: 'today' } as any);
    dir.children.set('journal', sub);
    await importFromFSAA(wrapAsFSAA(dir));
    expect((await getNote('journal/day.md'))?.content).toBe('today');
  });

  it('skips hidden directories', async () => {
    const dir = createMockDir();
    const hidden = createMockDir('.git');
    hidden.children.set('config', { kind: 'file', name: 'config', content: 'x' } as any);
    dir.children.set('.git', hidden);
    dir.children.set('a.md', { kind: 'file', name: 'a.md', content: 'A' } as any);
    const count = await importFromFSAA(wrapAsFSAA(dir));
    expect(count).toBe(1);
  });

  it('reports progress', async () => {
    const dir = createMockDir();
    dir.children.set('a.md', { kind: 'file', name: 'a.md', content: 'A' } as any);
    dir.children.set('b.md', { kind: 'file', name: 'b.md', content: 'B' } as any);
    const seen: Array<[number, number]> = [];
    await importFromFSAA(wrapAsFSAA(dir), (cur, total) => seen.push([cur, total]));
    expect(seen[seen.length - 1]).toEqual([2, 2]);
  });
});

describe('migrate.exportToFSAA', () => {
  it('exports flat notes', async () => {
    await putNote('x.md', '# X');
    const dir = createMockDir();
    const n = await exportToFSAA(wrapAsFSAA(dir));
    expect(n).toBe(1);
    expect((dir.children.get('x.md') as any)?.content).toBe('# X');
  });

  it('creates subdirectories as needed', async () => {
    await putNote('journal/y.md', 'day note');
    const dir = createMockDir();
    await exportToFSAA(wrapAsFSAA(dir));
    const journal = dir.children.get('journal') as any;
    expect(journal?.kind).toBe('directory');
    expect((journal?.children.get('y.md') as any)?.content).toBe('day note');
  });
});
