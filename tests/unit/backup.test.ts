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
