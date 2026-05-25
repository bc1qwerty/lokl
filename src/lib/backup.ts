import JSZip from 'jszip';
import { getDB, putNote, getNote } from './db';
import type { NoteDoc } from './db';

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
 * `${base} (conflict-${ts}-${rand}).md` with `conflictOf: id`.
 * Returns counts of new imports vs collision-siblings.
 */
export async function importJSON(blob: Blob): Promise<{ imported: number; conflicts: number }> {
  const text = await blob.text();
  const payload = JSON.parse(text) as BackupPayload;
  if (!payload || payload.version !== 1 || !Array.isArray(payload.notes)) {
    throw new Error('Invalid backup payload');
  }
  let imported = 0;
  let conflicts = 0;
  for (const note of payload.notes) {
    if (!note?._id) continue;
    const existing = await getNote(note._id);
    if (!existing) {
      await putNote(note._id, note.content ?? '');
      imported++;
      continue;
    }
    if (existing.content === note.content) continue;
    // Collision: keep both
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = Math.random().toString(36).slice(2, 8);
    const base = note._id.replace(/\.md$/, '');
    const siblingId = `${base} (conflict-${ts}-${rand}).md`;
    await putNote(siblingId, note.content ?? '');
    const sibling = await getNote(siblingId);
    if (sibling) {
      await getDB().put({ ...sibling, conflictOf: note._id });
    }
    conflicts++;
  }
  return { imported, conflicts };
}
