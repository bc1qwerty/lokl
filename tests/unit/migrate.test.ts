import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { createMockDir, wrapAsFSAA } from '../helpers/mock-fsaa';
import { setDB, listNotes, putNote, getNote } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { importFromFSAA, exportToFSAA, describeImport } from '../../src/lib/migrate';

beforeEach(() => setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>));

describe('migrate.importFromFSAA', () => {
  it('imports markdown files at top level', async () => {
    const dir = createMockDir();
    dir.children.set('a.md', { kind: 'file', name: 'a.md', content: '# Hello' } as any);
    dir.children.set('b.md', { kind: 'file', name: 'b.md', content: '# B' } as any);
    const report = await importFromFSAA(wrapAsFSAA(dir));
    expect(report).toEqual({ imported: 2, skipped: [], renamed: [] });
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
    const { imported } = await importFromFSAA(wrapAsFSAA(dir));
    expect(imported).toBe(1);
  });

  it('reports progress', async () => {
    const dir = createMockDir();
    dir.children.set('a.md', { kind: 'file', name: 'a.md', content: 'A' } as any);
    dir.children.set('b.md', { kind: 'file', name: 'b.md', content: 'B' } as any);
    const seen: Array<[number, number]> = [];
    await importFromFSAA(wrapAsFSAA(dir), (cur, total) => seen.push([cur, total]));
    expect(seen[seen.length - 1]).toEqual([2, 2]);
  });

  // PouchDB refuses ids that start with "_". The import used to throw out of its
  // loop at the first such file and leave a partial vault that looked complete.
  it('imports files and folders whose name starts with "_" under a visible replacement', async () => {
    const dir = createMockDir();
    dir.children.set('_index.md', { kind: 'file', name: '_index.md', content: 'INDEX' } as any);
    const tpl = createMockDir('_templates');
    tpl.children.set('daily.md', { kind: 'file', name: 'daily.md', content: 'TPL' } as any);
    dir.children.set('_templates', tpl);
    const sub = createMockDir('notes');
    sub.children.set('_inner.md', { kind: 'file', name: '_inner.md', content: 'INNER' } as any);
    dir.children.set('notes', sub);
    dir.children.set('z.md', { kind: 'file', name: 'z.md', content: 'Z' } as any);

    const report = await importFromFSAA(wrapAsFSAA(dir));
    expect(report.imported).toBe(4);
    expect(report.skipped).toEqual([]);
    expect(report.renamed).toEqual([
      { from: '_index.md', to: '-index.md' },
      { from: '_templates/daily.md', to: '-templates/daily.md' },
    ]);
    expect((await getNote('-index.md'))?.content).toBe('INDEX');
    expect((await getNote('-templates/daily.md'))?.content).toBe('TPL');
    // only the start of the id is reserved — nested underscores stay as they are
    expect((await getNote('notes/_inner.md'))?.content).toBe('INNER');
    expect((await getNote('z.md'))?.content).toBe('Z');
    expect(describeImport(report)).toContain('_index.md → -index.md');
  });

  it('a replacement name that collides with another file is skipped and reported, not merged', async () => {
    const dir = createMockDir();
    dir.children.set('_a.md', { kind: 'file', name: '_a.md', content: 'UNDERSCORE' } as any);
    dir.children.set('-a.md', { kind: 'file', name: '-a.md', content: 'DASH' } as any);
    const report = await importFromFSAA(wrapAsFSAA(dir));
    expect(report.imported).toBe(1);
    expect(report.skipped.map((s) => s.path)).toEqual(['_a.md']);
    expect((await getNote('-a.md'))?.content).toBe('DASH');
    expect(describeImport(report)).toMatch(/Skipped 1: _a\.md/);
  });

  it('one unreadable file does not end the import', async () => {
    const dir = createMockDir();
    dir.children.set('a.md', { kind: 'file', name: 'a.md', content: 'A' } as any);
    dir.children.set('bad.md', { kind: 'file', name: 'bad.md', content: 'B' } as any);
    dir.children.set('c.md', { kind: 'file', name: 'c.md', content: 'C' } as any);
    const handle = wrapAsFSAA(dir);
    const values = handle.values.bind(handle);
    handle.values = async function* () {
      for await (const entry of values()) {
        if (entry.name === 'bad.md') entry.getFile = async () => { throw new Error('NotReadableError'); };
        yield entry;
      }
    };
    const seen: number[] = [];
    const report = await importFromFSAA(handle, (cur) => seen.push(cur));
    expect(report.imported).toBe(2);
    expect(report.skipped).toEqual([{ path: 'bad.md', reason: 'NotReadableError' }]);
    expect(seen).toEqual([1, 2, 3]);
    expect((await getNote('c.md'))?.content).toBe('C');
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

  it('leaves no .lokl-tmp residue on success', async () => {
    await putNote('a.md', 'A');
    await putNote('b.md', 'B');
    const dir = createMockDir();
    await exportToFSAA(wrapAsFSAA(dir));
    for (const name of dir.children.keys()) {
      expect(name.endsWith('.lokl-tmp')).toBe(false);
    }
  });

  it('does not corrupt destination when temp write fails', async () => {
    await putNote('p.md', 'partial-content');
    const dir = createMockDir();
    // Seed the destination so we can detect corruption
    dir.children.set('p.md', { kind: 'file', name: 'p.md', content: 'ORIGINAL' } as any);
    // Pre-seed the temp file with failClose so atomicWrite fails before promoting to final
    dir.children.set('p.md.lokl-tmp', { kind: 'file', name: 'p.md.lokl-tmp', content: '', failClose: true } as any);

    let threw = false;
    try {
      await exportToFSAA(wrapAsFSAA(dir));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // Original destination still has its original content
    expect((dir.children.get('p.md') as any).content).toBe('ORIGINAL');
    // No .lokl-tmp left behind
    expect(dir.children.get('p.md.lokl-tmp')).toBeUndefined();
  });
});
