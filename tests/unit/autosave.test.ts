import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, getDB, getNote, putNote, listConflictSiblings } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { currentFilePath, currentFileContent, savedContent, isDirty, openTabs, addTab } from '../../src/lib/store';
import { startAutosave, flushPendingSave, settleOpenNote, saveNote, showNote, saveStatus, applyChange, expectLocalRemoval } from '../../src/lib/autosave';
import { toasts } from '../../src/lib/toast';

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
  openTabs.value = [];
  toasts.value = [];
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

  // Two saves of one note used to overlap (debounce timer + Ctrl+S / a flush).
  // Both carried the same baseRev, so the second parked the first's text as a
  // conflict copy of the user's own typing.
  it('overlapping saves of the same note run in order and leave no conflict copy', async () => {
    await putNote('n.md', 'base');
    await open('n.md');
    currentFileContent.value = 'one';
    const a = saveNote('n.md', 'one');
    currentFileContent.value = 'one two';
    const b = saveNote('n.md', 'one two');
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect((await getNote('n.md'))?.content).toBe('one two');
    expect(await listConflictSiblings()).toEqual([]);
    expect(isDirty.value).toBe(false);
  });

  it('text typed while a save is in flight stays in the store and is saved next', async () => {
    await putNote('n.md', '');
    await open('n.md');
    currentFileContent.value = 'first';
    const p = saveNote('n.md', 'first');
    currentFileContent.value = 'first+typed-during-save';
    await p;
    // the finished save recorded its own snapshot, not the newer text
    expect(savedContent.value).toBe('first');
    expect(currentFileContent.value).toBe('first+typed-during-save');
    expect(isDirty.value).toBe(true);
    await until(async () => (await getNote('n.md'))?.content === 'first+typed-during-save');
  });

  it('settleOpenNote keeps flushing until text typed during the flush is saved too', async () => {
    await putNote('n.md', '');
    await open('n.md');
    currentFileContent.value = 'a';
    const settled = settleOpenNote();
    currentFileContent.value = 'ab'; // lands while the first flush is awaiting
    expect(await settled).toBe(true);
    expect(isDirty.value).toBe(false);
    expect((await getNote('n.md'))?.content).toBe('ab');
  });

  it('a failed save is retried without another keystroke', async () => {
    stop();
    stop = startAutosave(DELAY, 40);
    await putNote('n.md', '');
    await open('n.md');
    const db = getDB() as any;
    const realPut = db.put.bind(db);
    let failures = 2;
    db.put = (...a: unknown[]) => (failures-- > 0 ? Promise.reject(new Error('disk says no')) : realPut(...a));
    try {
      currentFileContent.value = 'must survive';
      // debounced save fails, retry 1 fails, retry 2 lands — no further input
      await until(async () => (await getNote('n.md'))?.content === 'must survive', 4000);
      await until(() => !isDirty.value);
      expect(failures).toBeLessThan(0);
      // one toast for the whole streak, not one per retry
      expect(toasts.value.length).toBe(1);
    } finally {
      db.put = realPut;
    }
  });
});

describe('applyChange (the change feed meeting the editor)', () => {
  // A rename/delete in another tab or device arrives as a tombstone with no
  // content. It was adopted like an edit: the editor went blank, turned dirty,
  // and a second later "" was saved back under the removed id.
  it('a tombstone for the open, clean note closes it and writes nothing back', async () => {
    await putNote('alpha.md', 'hello');
    await open('alpha.md');
    addTab('alpha.md');
    const doc = await getDB().get('alpha.md');
    await getDB().remove(doc as NoteDoc & { _rev: string });
    expect(applyChange({ _id: 'alpha.md', _rev: '2-x', _deleted: true } as any)).toBe('closed');
    expect(currentFilePath.value).toBeNull();
    expect(openTabs.value).toEqual([]);
    await wait(DELAY * 4);
    await expect(getDB().get('alpha.md')).rejects.toMatchObject({ status: 404 });
  });

  it('a tombstone never discards unsaved edits', async () => {
    await putNote('alpha.md', 'hello');
    await open('alpha.md');
    currentFileContent.value = 'hello, still typing';
    expect(applyChange({ _id: 'alpha.md', _rev: '2-x', _deleted: true } as any)).toBe('ignored');
    expect(currentFileContent.value).toBe('hello, still typing');
    expect(currentFilePath.value).toBe('alpha.md');
  });

  it('a note trashed elsewhere is closed too', async () => {
    await putNote('t.md', 'x');
    await open('t.md');
    addTab('t.md');
    expect(applyChange({ ...(await getDB().get('t.md')), trashed: true } as any)).toBe('closed');
    expect(currentFilePath.value).toBeNull();
  });

  it('a tombstone for a background tab closes that tab and leaves the editor alone', async () => {
    await putNote('a.md', 'A');
    await putNote('b.md', 'B');
    addTab('a.md');
    await open('b.md');
    addTab('b.md');
    expect(applyChange({ _id: 'a.md', _rev: '2-x', _deleted: true } as any)).toBe('closed');
    expect(openTabs.value).toEqual(['b.md']);
    expect(currentFilePath.value).toBe('b.md');
    expect(currentFileContent.value).toBe('B');
  });

  it('ignores the tombstone of an id this tab is renaming', async () => {
    await putNote('old.md', 'x');
    await open('old.md');
    const done = expectLocalRemoval('old.md');
    expect(applyChange({ _id: 'old.md', _rev: '2-x', _deleted: true } as any)).toBe('ignored');
    expect(currentFilePath.value).toBe('old.md');
    done();
    expect(applyChange({ _id: 'old.md', _rev: '2-x', _deleted: true } as any)).toBe('closed');
  });

  it('adopts a newer remote revision of the clean open note', async () => {
    await putNote('n.md', 'v1');
    await open('n.md');
    await putNote('n.md', 'v2 from elsewhere');
    expect(applyChange(await getDB().get('n.md'))).toBe('adopted');
    expect(currentFileContent.value).toBe('v2 from elsewhere');
    expect(isDirty.value).toBe(false);
  });

  // The feed echoes our own saves. An echo of save N arriving after save N+1
  // finished must not put the older text back into the editor.
  it('a late echo of an older own save does not roll the editor back', async () => {
    await putNote('n.md', '');
    await open('n.md');
    currentFileContent.value = 'one';
    await saveNote('n.md', 'one');
    const echoOfFirst = await getDB().get('n.md');
    currentFileContent.value = 'one two';
    await saveNote('n.md', 'one two');
    expect(applyChange(echoOfFirst)).toBe('ignored');
    expect(currentFileContent.value).toBe('one two');
    expect(applyChange(await getDB().get('n.md'))).toBe('ignored'); // echo of the latest: nothing to do
    expect(isDirty.value).toBe(false);
  });

  it('showNote with a draft opens the note dirty and the draft gets saved', async () => {
    await putNote('new.md', 'renamed body');
    const n = await getNote('new.md');
    showNote('new.md', n!.content, n!._rev, 'renamed body + typed during rename');
    expect(isDirty.value).toBe(true);
    await until(async () => (await getNote('new.md'))?.content === 'renamed body + typed during rename');
    expect(await listConflictSiblings()).toEqual([]);
  });
});
