import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, getDB, getNote, putNote, listConflictSiblings } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { currentFilePath, currentFileContent, isDirty } from '../../src/lib/store';
import { startAutosave, flushPendingSave, showNote, saveStatus } from '../../src/lib/autosave';

const DELAY = 30;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(cond: () => boolean | Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await wait(10);
  }
  throw new Error('condition not met in time');
}
async function open(path: string) {
  const n = await getNote(path);
  showNote(path, n!.content, n!._rev);
}

let stop: () => void;

beforeEach(() => {
  setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>);
  showNote(null, '');
  saveStatus.value = 'clean';
  stop = startAutosave(DELAY);
});
afterEach(() => stop());

describe('autosave', () => {
  // 2026-11: the debounce timer lived in a signal the effect both read and
  // wrote, so it re-armed forever and never fired. Every e2e saved with Ctrl+S.
  it('saves an edit after the debounce without any manual save', async () => {
    await putNote('a.md', '');
    await open('a.md');
    currentFileContent.value = 'HELLO';
    expect(saveStatus.value).toBe('dirty');
    await until(async () => (await getNote('a.md'))?.content === 'HELLO');
    await until(() => !isDirty.value);
    expect(['saved', 'clean']).toContain(saveStatus.value);
  });

  it('typing keeps one pending save, which carries the latest text', async () => {
    await putNote('a.md', '');
    await open('a.md');
    for (const t of ['a', 'ab', 'abc']) { currentFileContent.value = t; await wait(5); }
    await until(async () => (await getNote('a.md'))?.content === 'abc');
    // create + one save = 2 revisions
    expect((await getDB().get('a.md'))._rev.startsWith('2-')).toBe(true);
  });

  // The old timer wrote `currentFileContent` to the path captured earlier —
  // after a switch that is the other note's text.
  it('switching notes right after an edit does not write the new note over the old one', async () => {
    await putNote('aaa.md', 'A0');
    await putNote('bbb.md', 'CONTENT-OF-B');
    await open('aaa.md');
    currentFileContent.value = 'A-EDITED';
    // what handleFileClick does
    expect(await flushPendingSave()).toBe(true);
    await open('bbb.md');
    await wait(DELAY * 4);
    expect((await getNote('aaa.md'))?.content).toBe('A-EDITED');
    expect((await getNote('bbb.md'))?.content).toBe('CONTENT-OF-B');
    expect(currentFilePath.value).toBe('bbb.md');
    expect(isDirty.value).toBe(false);
  });

  it('a pending timer is cancelled when the editor switches without a flush', async () => {
    await putNote('aaa.md', 'A0');
    await putNote('bbb.md', 'B0');
    await open('aaa.md');
    currentFileContent.value = 'A-EDITED';
    await open('bbb.md');
    await wait(DELAY * 4);
    expect((await getNote('bbb.md'))?.content).toBe('B0');
    expect((await getNote('aaa.md'))?.content).toBe('A0');
  });

  it('flushPendingSave is a no-op when nothing is dirty', async () => {
    await putNote('a.md', 'x');
    await open('a.md');
    expect(await flushPendingSave()).toBe(true);
    expect((await getDB().get('a.md'))._rev.startsWith('1-')).toBe(true);
  });

  it('keeps a remote edit that arrived mid-typing as a conflict copy', async () => {
    await putNote('n.md', 'base');
    await open('n.md');
    currentFileContent.value = 'mine';
    // a sync pull lands while the note is dirty (the change feed skips dirty notes)
    await putNote('n.md', 'theirs');
    await until(async () => (await getNote('n.md'))?.content === 'mine');
    const siblings = await listConflictSiblings();
    expect(siblings.map(s => s.content)).toEqual(['theirs']);
    expect(siblings[0].conflictOf).toBe('n.md');
  });

  it('own consecutive saves do not create conflict copies', async () => {
    await putNote('n.md', 'base');
    await open('n.md');
    currentFileContent.value = 'one';
    await until(async () => (await getNote('n.md'))?.content === 'one');
    currentFileContent.value = 'two';
    await until(async () => (await getNote('n.md'))?.content === 'two');
    expect(await listConflictSiblings()).toEqual([]);
  });
});
