import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { createMockDir, wrapAsFSAA } from '../helpers/mock-fsaa';
import { setDB, getDB, listNotes, listConflictSiblings, listTrash, putNote, getNote, deleteNote } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { importFromFSAA, exportToFSAA, describeImport, interruptedImport, importRunning } from '../../src/lib/migrate';

beforeEach(() => {
  setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>);
  localStorage.clear();
});

function folder(files: Record<string, string>) {
  const dir = createMockDir();
  for (const [name, content] of Object.entries(files)) dir.children.set(name, { kind: 'file', name, content } as any);
  return dir;
}

describe('migrate.importFromFSAA', () => {
  it('imports markdown files at top level', async () => {
    const dir = createMockDir();
    dir.children.set('a.md', { kind: 'file', name: 'a.md', content: '# Hello' } as any);
    dir.children.set('b.md', { kind: 'file', name: 'b.md', content: '# B' } as any);
    const report = await importFromFSAA(wrapAsFSAA(dir));
    expect(report).toEqual({ imported: 2, unchanged: 0, conflicts: [], skipped: [], renamed: [] });
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

// The import used to write every file with a plain put: a note of the same name
// already in the vault (another tab created one while the welcome screen was up,
// or this is a second run) was replaced without a word.
describe('migrate.importFromFSAA into a vault that already has notes', () => {
  it('never overwrites: same text is left alone, different text is kept as a conflict copy', async () => {
    await putNote('same.md', 'identical');
    await putNote('n1.md', 'written in the app');
    const rev = (await getDB().get('n1.md'))._rev;

    const report = await importFromFSAA(wrapAsFSAA(folder({ 'same.md': 'identical', 'n1.md': 'older text from the folder', 'new.md': 'fresh' })));
    expect(report.imported).toBe(1);
    expect(report.unchanged).toBe(1);
    expect(report.conflicts.map((c) => c.path)).toEqual(['n1.md']);
    expect(report.skipped).toEqual([]);

    // the vault's note is untouched — same revision, same text
    expect((await getDB().get('n1.md'))._rev).toBe(rev);
    expect((await getNote('n1.md'))?.content).toBe('written in the app');
    // the folder's text is there too, as a conflict copy the panel shows
    const copies = await listConflictSiblings();
    expect(copies.map((c) => [c.conflictOf, c.content])).toEqual([['n1.md', 'older text from the folder']]);
    expect(copies[0]._id).toBe(report.conflicts[0].keptAs);
    expect((await listNotes()).map((n) => n._id).sort()).toEqual(['n1.md', 'new.md', 'same.md']);
    expect(describeImport(report)).toMatch(/1 already in the vault\. 1 differ.*kept as conflict copies: n1\.md/);
  });

  it('running the same import again changes nothing and adds no second copy', async () => {
    await putNote('n1.md', 'written in the app');
    const dir = folder({ 'n1.md': 'from the folder', 'a.md': 'A', '_i.md': 'I' });
    await importFromFSAA(wrapAsFSAA(dir));
    const again = await importFromFSAA(wrapAsFSAA(dir));
    expect(again).toEqual({ imported: 0, unchanged: 3, conflicts: [], skipped: [], renamed: [] });
    expect(await listConflictSiblings()).toHaveLength(1);
  });

  it('a name that is only in the trash is imported, and the trashed text is kept in the trash', async () => {
    await putNote('t.md', 'thrown away');
    await deleteNote('t.md');
    const report = await importFromFSAA(wrapAsFSAA(folder({ 't.md': 'from the folder' })));
    expect(report.imported).toBe(1);
    expect((await getNote('t.md'))?.content).toBe('from the folder');
    expect((await listTrash()).map((d) => d.content)).toEqual(['thrown away']);
  });

  it('takes ".MD" and ".markdown" files, under an ".md" id, and says so', async () => {
    const report = await importFromFSAA(wrapAsFSAA(folder({ 'README.MD': 'R', 'notes.markdown': 'N', 'plain.md': 'P', 'skip.txt': 'T' })));
    expect(report.imported).toBe(3);
    expect(report.renamed).toEqual([{ from: 'README.MD', to: 'README.md' }, { from: 'notes.markdown', to: 'notes.md' }]);
    expect((await listNotes()).map((n) => n._id).sort()).toEqual(['README.md', 'notes.md', 'plain.md']);
  });

  it('two files that end up with the same id are not merged: the second is reported', async () => {
    const report = await importFromFSAA(wrapAsFSAA(folder({ 'a.md': 'lower', 'a.markdown': 'other' })));
    expect(report.imported).toBe(1);
    expect(report.skipped.map((x) => x.path)).toEqual(['a.markdown']);
    expect((await getNote('a.md'))?.content).toBe('lower');
  });
});

// A reload or a closed tab in the middle left a partial vault that opened as if whole.
describe('migrate.importFromFSAA that does not finish', () => {
  const many = () => folder(Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`n${String(i).padStart(2, '0')}.md`, `body ${i}`])));

  it('leaves a marker the next start can report, and a second run finishes the job', async () => {
    expect(await interruptedImport()).toBeNull();
    // the page going away mid-import, as far as the loop can tell
    await expect(importFromFSAA(wrapAsFSAA(many()), (cur) => { if (cur === 45) throw new Error('page gone'); }))
      .rejects.toThrow('page gone');
    expect(await interruptedImport()).toEqual({ done: 40, total: 60 });
    expect(await listNotes()).toHaveLength(45);
    expect(importRunning()).toBe(false);

    const report = await importFromFSAA(wrapAsFSAA(many()));
    expect(report).toEqual({ imported: 15, unchanged: 45, conflicts: [], skipped: [], renamed: [] });
    expect(await listNotes()).toHaveLength(60);
    expect(await interruptedImport()).toBeNull();
  });

  it('asks before the page is closed while it is writing, and only then', async () => {
    const fire = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(fire()).toBe(false);
    let during = false;
    await importFromFSAA(wrapAsFSAA(many()), (cur) => { if (cur === 5) during = fire() && importRunning(); });
    expect(during).toBe(true);
    expect(fire()).toBe(false);
  });

  it('an import still running in another tab is not reported as interrupted', async () => {
    localStorage.setItem('lokl_import_progress', JSON.stringify({ done: 20, total: 60 }));
    const nav = navigator as any;
    const had = Object.getOwnPropertyDescriptor(nav, 'locks');
    Object.defineProperty(nav, 'locks', { configurable: true, value: {
      request: async (_n: string, fn: () => Promise<unknown>) => fn(),
      query: async () => ({ held: [{ name: 'lokl-folder-import' }] }),
    } });
    try {
      expect(await interruptedImport()).toBeNull();
      nav.locks.query = async () => ({ held: [] });
      expect(await interruptedImport()).toEqual({ done: 20, total: 60 });
    } finally {
      if (had) Object.defineProperty(nav, 'locks', had); else delete nav.locks;
    }
  });

  it('a finished import with skipped files is not "interrupted"', async () => {
    await importFromFSAA(wrapAsFSAA(folder({ '_a.md': 'U', '-a.md': 'D' })));
    expect(await interruptedImport()).toBeNull();
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
