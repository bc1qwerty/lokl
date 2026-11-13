import { getDB, getNote } from './db';
import { contentHash } from './note-path';
import type { NoteDoc } from './db';

// Raw existence check that includes trashed/deleted docs — getNote()
// filters them out, which would let us re-import on top of a trashed
// row and trigger a PouchDB rev conflict.
async function rawExists(id: string): Promise<boolean> {
  try {
    await getDB().get(id);
    return true;
  } catch (e: unknown) {
    if ((e as { status?: number }).status === 404) return false;
    throw e;
  }
}

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  notes: NoteDoc[];
}

/**
 * Export all docs (including trashed + conflictOf) to a JSON blob for full-fidelity backup.
 */
export async function exportJSON(): Promise<Blob> {
  const result = await getDB().allDocs({ include_docs: true });
  const notes = result.rows
    .map(r => r.doc as NoteDoc | undefined)
    .filter((d): d is NoteDoc => !!d)
    .map(({ _rev, ...rest }) => rest as NoteDoc);
  const payload: BackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    notes,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

/**
 * Export visible markdown files (excludes trashed + conflict siblings) to a ZIP.
 */
export async function exportZIP(): Promise<Blob> {
  // Loaded on demand — only this export needs it (~95KB out of the main bundle).
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const result = await getDB().allDocs({ include_docs: true });
  for (const row of result.rows) {
    const doc = row.doc as NoteDoc | undefined;
    if (!doc) continue;
    if (doc.trashed || doc.conflictOf || doc.deleted) continue;
    if (doc._id.startsWith('_')) continue;
    zip.file(doc._id, doc.content);
  }
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Import a JSON backup. On id collision, the imported note is kept as a sibling
 * `${base} (conflict-import-<content hash>).md` with `conflictOf: id`.
 * Returns counts of new imports vs collision-siblings.
 */
export async function importJSON(blob: Blob): Promise<{ imported: number; conflicts: number }> {
  const text = await blob.text();
  const payload = JSON.parse(text) as BackupPayload;
  if (!payload || payload.version !== 1 || !Array.isArray(payload.notes)) {
    throw new Error('Invalid backup payload');
  }
  // Validate everything before writing anything: a bad entry halfway through
  // used to throw and leave a partial import behind.
  for (const note of payload.notes) {
    if (!note || typeof note !== 'object') throw new Error('Invalid backup payload: note is not an object');
    if (typeof note._id !== 'string' || !note._id || note._id.startsWith('_')) {
      throw new Error('Invalid backup payload: bad note id');
    }
    if (typeof note.content !== 'string') {
      throw new Error(`Invalid backup payload: "${note._id}" has no text content`);
    }
  }
  let imported = 0;
  let conflicts = 0;
  // Copies an earlier import of this same backup already left behind.
  const alreadyKept = new Set<string>();
  for (const row of (await getDB().allDocs({ include_docs: true })).rows) {
    const d = row.doc as NoteDoc | undefined;
    if (d?.conflictOf) alreadyKept.add(`${d.conflictOf}\u0000${d.content}`);
  }
  for (const note of payload.notes) {
    // Strip any stray _rev the payload might still carry (exportJSON
    // already does this, but defend against hand-edited blobs).
    const { _rev: _, ...payloadDoc } = note as NoteDoc & { _rev?: string };
    const exists = await rawExists(note._id);
    if (!exists) {
      // Preserve every field from the backup — trashed/trashedAt/tags/
      // links/title/createdAt/conflictOf round-trip with full fidelity.
      await getDB().put(payloadDoc);
      imported++;
      continue;
    }
    // Compare against the stored doc whatever its state. getNote() hides trashed
    // notes, so every re-import of the same backup added another copy of each.
    const existing = await getDB().get(note._id);
    if (existing.content === note.content) continue;
    if (alreadyKept.has(`${note._id}\u0000${note.content}`)) continue;
    // Collision: keep both. The sibling inherits the payload's metadata
    // (tags, trashed flag, etc.) but lives at a new id and points back
    // at the original via conflictOf.
    // The copy's id comes from the text alone (as in the folder import): two devices importing the
    // same backup then write the same document instead of one copy each.
    const base = note._id.replace(/\.md$/, '');
    const siblingId = `${base} (conflict-import-${contentHash(note.content)}).md`;
    alreadyKept.add(`${note._id}\u0000${note.content}`);
    // Already there (kept by an earlier run or another device, or since edited or binned): leave it.
    if (await rawExists(siblingId)) continue;
    await getDB().put({ ...payloadDoc, _id: siblingId, conflictOf: note._id });
    conflicts++;
  }
  return { imported, conflicts };
}
