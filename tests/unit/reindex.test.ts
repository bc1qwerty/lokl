import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, putNote, deleteNote, listNotes, buildFileTree, getDB } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { fileTree, backlinksIndex, wikilinksIndex, tagsIndex } from '../../src/lib/store';
import { search, clearIndex } from '../../src/lib/search';
import { indexChange, refreshLinks, treeIsStale, takeChanges } from '../../src/lib/reindex';
import { resetLinkIndex } from '../../src/lib/markdown';

beforeEach(() => {
  setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>);
  clearIndex();
  fileTree.value = [];
  takeChanges();   // drop anything a previous test left pending
  resetLinkIndex();
});

async function feed(id: string) {
  indexChange(await getDB().get(id) as NoteDoc);
}

describe('change feed keeps search and links current', () => {
  it('a note that arrives by sync/import is searchable without a reload', async () => {
    await putNote('arrived.md', 'zebra crossing');
    expect(search('zebra')).toHaveLength(0);
    await feed('arrived.md');
    expect(search('zebra').map((r) => r.id)).toEqual(['arrived.md']);
  });

  it('a trashed or conflict-copy document leaves the index', async () => {
    await putNote('gone.md', 'quokka');
    await feed('gone.md');
    await deleteNote('gone.md');
    await feed('gone.md');
    expect(search('quokka')).toHaveLength(0);

    indexChange({ _id: 'x (conflict-1-a).md', content: 'quokka', conflictOf: 'x.md', updatedAt: '', createdAt: '' } as NoteDoc);
    expect(search('quokka')).toHaveLength(0);
    // and it does not plant an empty entry in the link graph
    expect(wikilinksIndex.value.has('x (conflict-1-a).md')).toBe(false);
  });

  it('a link written before its target arrived resolves once the target is there', async () => {
    await putNote('source.md', 'see [[target]] #tagged');
    let notes = await listNotes();
    fileTree.value = buildFileTree(notes);
    refreshLinks(takeChanges(), notes);
    expect(backlinksIndex.value.get('target.md')).toBeUndefined();

    await putNote('target.md', 'here');
    notes = await listNotes();
    fileTree.value = buildFileTree(notes);
    refreshLinks(takeChanges(), notes);
    expect([...(backlinksIndex.value.get('target.md') ?? [])]).toEqual(['source.md']);
    expect([...(tagsIndex.value.get('tagged') ?? [])]).toEqual(['source.md']);
  });

  it('an ordinary save does not ask for the note list again; an arrival or a removal does', async () => {
    await putNote('a.md', 'one');
    fileTree.value = buildFileTree(await listNotes());
    refreshLinks(takeChanges(), await listNotes());

    await putNote('a.md', 'two');
    await feed('a.md');
    let batch = takeChanges();
    expect(treeIsStale(batch)).toBe(false);
    refreshLinks(batch);

    await putNote('b.md', 'new');
    await feed('b.md');
    batch = takeChanges();
    expect(treeIsStale(batch)).toBe(true);
    fileTree.value = buildFileTree(await listNotes());
    refreshLinks(batch, await listNotes());

    await deleteNote('b.md');
    await feed('b.md');
    expect(treeIsStale(takeChanges())).toBe(true);
  });

  // The note list is read asynchronously. A change that lands after the batch
  // was taken must wait for its own round — it must not be swallowed.
  it('a change reported while the note list was being read is kept for the next round', async () => {
    await putNote('a.md', 'x');
    await feed('a.md');
    const batch = takeChanges();
    const notes = await listNotes();           // …the list is read…
    await deleteNote('a.md');                  // …and meanwhile the note is removed
    await feed('a.md');
    fileTree.value = buildFileTree(notes);
    refreshLinks(batch, notes);
    expect(wikilinksIndex.value.has('a.md')).toBe(true);   // as of that list

    const next = takeChanges();
    expect(treeIsStale(next)).toBe(true);
    const now = await listNotes();
    fileTree.value = buildFileTree(now);
    refreshLinks(next, now);
    expect(wikilinksIndex.value.has('a.md')).toBe(false);
  });

  it('a removed note leaves the link graph, and links to it stop resolving', async () => {
    await putNote('source.md', 'see [[target]]');
    await putNote('target.md', 'x #t');
    let notes = await listNotes();
    fileTree.value = buildFileTree(notes);
    refreshLinks(takeChanges(), notes);
    expect(wikilinksIndex.value.get('source.md')).toEqual(['target.md']);

    await deleteNote('target.md');
    await feed('target.md');
    notes = await listNotes();
    fileTree.value = buildFileTree(notes);
    refreshLinks(takeChanges(), notes);
    expect(wikilinksIndex.value.get('source.md')).toEqual([]);
    expect(wikilinksIndex.value.has('target.md')).toBe(false);
    expect(backlinksIndex.value.get('target.md')).toBeUndefined();
    expect(tagsIndex.value.get('t')).toBeUndefined();
  });
});
