import type { NoteDoc } from './db';
import { allFilePaths } from './store';
import { applyLinkChanges } from './markdown';
import { indexFile, removeFromIndex } from './search';

// Notes that arrive through the change feed (sync from another device, a backup
// import, another tab) were only added to the file tree: search, backlinks and
// tags did not know them until the next reload.

type FeedDoc = NoteDoc & { _deleted?: boolean };

const isGone = (doc: FeedDoc) => !!doc._deleted || !!doc.trashed || !!doc.deleted || !!doc.conflictOf;

// What the feed reported since the last refreshLinks(): id -> content, null = gone.
const pending = new Map<string, string | null>();

/** Per change, cheap: keep the search index in step with one document and note it for refreshLinks(). */
export function indexChange(doc: FeedDoc): void {
  if (isGone(doc)) {
    removeFromIndex(doc._id);
    pending.set(doc._id, null);
    return;
  }
  if (typeof doc.content === 'string') {
    indexFile(doc._id, doc.content);
    pending.set(doc._id, doc.content);
  }
}

export type ChangeBatch = Map<string, string | null>;

/** Take what the feed has reported so far. Later reports wait for the next round. */
export function takeChanges(): ChangeBatch {
  const batch = new Map(pending);
  pending.clear();
  return batch;
}

/**
 * True when the batch adds or removes a note the file tree does not reflect
 * yet — only then does the caller have to read the note list again.
 * An ordinary save changes neither, and re-reading every note after each one
 * (allDocs over the whole vault) was most of the cost of typing in a big vault.
 */
export function treeIsStale(batch: ChangeBatch): boolean {
  if (batch.size === 0) return false;
  const paths = new Set(allFilePaths.peek());
  for (const [id, content] of batch) {
    if ((content === null) === paths.has(id)) return true;
  }
  return false;
}

/**
 * Bring links, backlinks and tags up to date with a batch. Only the reported
 * notes are parsed again; when a note appeared or vanished, every stored link
 * is resolved again (a link written before its target arrived has to be looked
 * at again) — without re-reading any content.
 * Pass `notes` when the file tree was just rebuilt from them: the index is then
 * also reconciled against that list. The list must have been read AFTER the
 * batch was taken — otherwise a note removed in the batch comes back from it.
 * Call after the file tree (and with it the list of paths) is current.
 */
export function refreshLinks(batch: ChangeBatch = takeChanges(), notes?: NoteDoc[]): void {
  applyLinkChanges(batch, notes);
}
