import type { NoteDoc } from './db';
import { wikilinksIndex } from './store';
import { updateLinksForFile } from './markdown';
import { indexFile, removeFromIndex } from './search';

// Notes that arrive through the change feed (sync from another device, a backup
// import, another tab) were only added to the file tree: search, backlinks and
// tags did not know them until the next reload.

type FeedDoc = NoteDoc & { _deleted?: boolean };

const isGone = (doc: FeedDoc) => !!doc._deleted || !!doc.trashed || !!doc.deleted || !!doc.conflictOf;

/** Per change, cheap: keep the search index in step with one document. */
export function indexChange(doc: FeedDoc): void {
  if (isGone(doc)) {
    removeFromIndex(doc._id);
    if (wikilinksIndex.peek().has(doc._id)) updateLinksForFile(doc._id, '');
    return;
  }
  if (typeof doc.content === 'string') indexFile(doc._id, doc.content);
}

/**
 * After a burst of changes settles: resolve links for every note again. A link
 * is resolved against the list of existing notes, so a note written before its
 * target arrived has to be looked at again — one pass over all of them.
 * Call after the file tree (and with it the list of paths) has been rebuilt.
 */
export function refreshLinks(notes: NoteDoc[]): void {
  for (const note of notes) {
    if (typeof note.content === 'string') updateLinksForFile(note._id, note.content);
  }
}
