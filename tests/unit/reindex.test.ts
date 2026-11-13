import { describe, it, expect, beforeEach } from 'vitest';
import { freshDB } from '../helpers/memory-db';
import { setDB, putNote, deleteNote, listNotes, buildFileTree, getDB } from '../../src/lib/db';
import type { NoteDoc } from '../../src/lib/db';
import { fileTree, backlinksIndex, wikilinksIndex, tagsIndex } from '../../src/lib/store';
import { search, clearIndex } from '../../src/lib/search';
import { indexChange, refreshLinks } from '../../src/lib/reindex';

beforeEach(() => {
  setDB(freshDB() as unknown as PouchDB.Database<NoteDoc>);
  clearIndex();
  fileTree.value = [];
  wikilinksIndex.value = new Map();
  backlinksIndex.value = new Map();
  tagsIndex.value = new Map();
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
    refreshLinks(notes);
    expect(backlinksIndex.value.get('target.md')).toBeUndefined();

    await putNote('target.md', 'here');
    notes = await listNotes();
    fileTree.value = buildFileTree(notes);
    refreshLinks(notes);
    expect([...(backlinksIndex.value.get('target.md') ?? [])]).toEqual(['source.md']);
    expect([...(tagsIndex.value.get('tagged') ?? [])]).toEqual(['source.md']);
  });
});
