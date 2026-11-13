import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, putNote, listNotes, getNote, getDB } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { exportJSON, exportZIP, importJSON } from '../../src/lib/backup';
import JSZip from 'jszip';

beforeEach(() => setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>));

describe('backup.exportJSON / importJSON', () => {
  it('round-trips notes', async () => {
    await putNote('a.md', '# A');
    await putNote('b.md', '# B');
    const blob = await exportJSON();
    setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>);
    const result = await importJSON(blob);
    expect(result.imported).toBe(2);
    expect(result.conflicts).toBe(0);
    const all = await listNotes();
    expect(all.map(n => n._id).sort()).toEqual(['a.md', 'b.md']);
    expect((await getNote('a.md'))?.content).toBe('# A');
  });

  it('keeps both on import collision (content differs)', async () => {
    await putNote('a.md', 'original');
    const blob = await exportJSON();
    await putNote('a.md', 'newer');
    const result = await importJSON(blob);
    expect(result.conflicts).toBe(1);
    expect((await getNote('a.md'))?.content).toBe('newer');
    const raw = await getDB().allDocs({ include_docs: true });
    const sibling = raw.rows.map(r => r.doc as any).find(d => d?.conflictOf === 'a.md');
    expect(sibling).toBeDefined();
    expect(sibling!.content).toBe('original');
  });

  it('two devices importing the same backup keep the very same copy (same id, same revision)', async () => {
    const copyOf = async () => {
      const raw = await getDB().allDocs({ include_docs: true });
      const d = raw.rows.map(r => r.doc as any).find(x => x?.conflictOf === 'a.md');
      return { id: d._id as string, rev: d._rev as string };
    };
    await putNote('a.md', 'original');
    const blob = await exportJSON();
    await putNote('a.md', 'device one edit');
    await importJSON(blob);
    const one = await copyOf();

    setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>);
    await putNote('a.md', 'device two edit, different');
    await importJSON(blob);
    const two = await copyOf();

    expect(one.id).toMatch(/^a \(conflict-import-[0-9a-f]{16}\)\.md$/);
    expect(two).toEqual(one);
  });

  it('never writes over a copy the user has since edited', async () => {
    await putNote('a.md', 'original');
    const blob = await exportJSON();
    await putNote('a.md', 'newer');
    await importJSON(blob);
    const raw = await getDB().allDocs({ include_docs: true });
    const copy = raw.rows.map(r => r.doc as any).find(x => x?.conflictOf === 'a.md');
    await getDB().put({ ...copy, content: 'my notes on the old version' });
    expect(await importJSON(blob)).toEqual({ imported: 0, conflicts: 0 });
    expect((await getDB().get(copy._id)).content).toBe('my notes on the old version');
  });

  it('skips import when content is identical (no false conflicts)', async () => {
    await putNote('a.md', 'same');
    const blob = await exportJSON();
    const result = await importJSON(blob);
    expect(result.imported).toBe(0);
    expect(result.conflicts).toBe(0);
  });

  it('rejects invalid payload', async () => {
    const badBlob = new Blob([JSON.stringify({ foo: 'bar' })], { type: 'application/json' });
    await expect(importJSON(badBlob)).rejects.toThrow(/Invalid backup payload/);
  });
});

describe('backup.exportZIP', () => {
  it('exports visible markdown files', async () => {
    await putNote('a.md', '# A');
    await putNote('journal/day.md', '# Day');
    const blob = await exportZIP();
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).sort();
    expect(names).toContain('a.md');
    expect(names).toContain('journal/day.md');
  });

  it('skips trashed and conflict siblings', async () => {
    await putNote('a.md', 'A');
    await putNote('b.md', 'B');
    // Mark a.md as trashed via deleteNote → trash
    const { deleteNote } = await import('../../src/lib/db');
    await deleteNote('a.md');
    await putNote('sib.md', 's');
    const sib = await getDB().get('sib.md');
    await getDB().put({ ...sib, conflictOf: 'b.md' });
    const blob = await exportZIP();
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(['b.md']);
  });
});

describe('importJSON validation', () => {
  const blobOf = (notes: unknown[]) => new Blob([JSON.stringify({ version: 1, exportedAt: '', notes })]);

  it('rejects a payload with non-text content before writing anything', async () => {
    const blob = blobOf([{ _id: 'ok.md', content: 'fine' }, { _id: 'bad.md', content: { x: 1 } }]);
    await expect(importJSON(blob)).rejects.toThrow(/no text content/);
    expect(await listNotes()).toEqual([]);
  });

  it('rejects reserved ids', async () => {
    await expect(importJSON(blobOf([{ _id: '_design/x', content: '' }]))).rejects.toThrow(/bad note id/);
  });
});

describe('importing the same backup again adds nothing', () => {
  it('trashed notes and already-kept copies are not duplicated', async () => {
    await putNote('live.md', 'old text');
    await putNote('gone.md', 'in the trash');
    const gone = await getDB().get('gone.md');
    await getDB().put({ ...gone, trashed: true, trashedAt: new Date().toISOString() });
    const blob = await exportJSON();
    await putNote('live.md', 'new text');
    const count = async () => (await getDB().allDocs()).rows.length;

    const first = await importJSON(blob);
    expect(first).toEqual({ imported: 0, conflicts: 1 }); // live.md's old text kept as a copy
    const after = await count();
    const second = await importJSON(blob);
    expect(second).toEqual({ imported: 0, conflicts: 0 });
    expect(await count()).toBe(after);
  });
});
