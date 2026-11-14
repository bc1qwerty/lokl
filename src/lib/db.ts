import PouchDB from 'pouchdb-browser';
import { signal } from '@preact/signals';
import type { FileEntry } from '../types';

export interface NoteDoc {
  _id: string;        // normalized path e.g. "journal/2026-04-07.md"
  _rev?: string;
  content: string;
  title: string;       // extracted from first heading or filename
  tags: string[];
  links: string[];     // outgoing wiki-links
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
  // Trash (B1 will use; declared now so types compile)
  trashed?: boolean;
  trashedAt?: string;
  // Conflict (A2/A3 uses)
  conflictOf?: string;
  // Legacy soft-delete — migrated to `trashed` by B1's sweeper
  deleted?: boolean;
}

let db: PouchDB.Database<NoteDoc>;
let dbName = 'lokl';

/** Bumped when the database handle is replaced; long-lived listeners (change
 *  feed, sync) watch it and re-attach to the new handle. */
export const dbEpoch = signal(0);

export function initDB(name = 'lokl'): PouchDB.Database<NoteDoc> {
  if (!db) {
    dbName = name;
    db = new PouchDB<NoteDoc>(name, DB_OPTIONS);
  }
  return db;
}

// Every save used to leave the previous full text behind for good: a 200KB note saved 150 times
// held 30MB, and emptying the trash gave none of it back. Leaves (the current text and any
// conflict branch) are kept; only superseded revisions' bodies go.
const DB_OPTIONS = { auto_compaction: true };
const COMPACTED_FLAG = 'lokl-compacted-v1';

/** One sweep over what earlier versions left behind; auto_compaction covers every save after it. */
export async function compactOnce(): Promise<void> {
  try {
    if (localStorage.getItem(COMPACTED_FLAG)) return;
    await getDB().compact();
    localStorage.setItem(COMPACTED_FLAG, '1');
  } catch (e) {
    console.warn('Compaction skipped:', e);
  }
}

/** True for the errors a dead IndexedDB connection produces. The browser can
 *  close it under us (storage pressure, an aborted transaction PouchDB treats
 *  as fatal); from then on every read and write on that handle fails. */
/** The device (not the sync quota) is out of space. PouchDB reports it as
 *  `{ name: 'indexed_db_went_bad', status: 500, reason: 'QuotaExceededError' }`, not by name. */
export function isStorageFull(e: unknown): boolean {
  const x = e as { name?: string; reason?: string; message?: string } | null | undefined;
  return x?.name === 'QuotaExceededError' || x?.reason === 'QuotaExceededError'
    || /QuotaExceeded/i.test(String(x?.message ?? ''));
}

/** The first failure of a full device is often just "connection is closing" — ask the browser. */
export async function deviceStorageFull(): Promise<boolean> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est?.quota || est.usage == null) return false;
    return est.quota - est.usage < 1024 * 1024 || est.usage / est.quota > 0.98;
  } catch { return false; }
}

export const STORAGE_FULL_MESSAGE = 'This device is out of storage space — notes cannot be saved. Copy what you are writing somewhere safe, free up space on the device, then reload.';

export function isConnectionLost(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  const text = `${err?.name ?? ''} ${err?.message ?? ''}`;
  return /InvalidStateError|connection is closing|database connection|indexed_db_went_bad/i.test(text);
}

/** Replace a dead handle with a fresh connection to the same database. */
export function reopenDB(): PouchDB.Database<NoteDoc> {
  const old = db;
  db = new PouchDB<NoteDoc>(dbName, DB_OPTIONS);
  try { void (old as any)?.close?.().catch(() => undefined); } catch { /* already dead */ }
  dbEpoch.value++;
  return db;
}

export function getDB(): PouchDB.Database<NoteDoc> {
  if (!db) return initDB();
  return db;
}

export function setDB(instance: PouchDB.Database<NoteDoc>): void {
  db = instance;
  dbName = (instance as unknown as { name: string }).name ?? dbName;
}

// Extract title from markdown content
function extractTitle(content: string, path: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return path.split('/').pop()?.replace(/\.md$/, '') || path;
}

// Extract tags from content (#tag) and frontmatter
function extractTags(content: string): string[] {
  const tags = new Set<string>();
  // Inline tags
  const inline = content.match(/(?:^|\s)#([a-zA-Z0-9_\-/\u3131-\uD79D]+)/g);
  if (inline) {
    for (const t of inline) tags.add(t.trim().slice(1));
  }
  // Frontmatter tags
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const tagLine = fm[1].match(/tags:\s*\[([^\]]*)\]/);
    if (tagLine) {
      tagLine[1].split(',').forEach(t => {
        const tag = t.trim().replace(/['"]/g, '');
        if (tag) tags.add(tag);
      });
    }
  }
  return [...tags];
}

// Extract wiki-links [[target]]
function extractLinks(content: string): string[] {
  const links: string[] = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    links.push(m[1].split('|')[0].trim());
  }
  return links;
}

export async function getNote(id: string): Promise<NoteDoc | null> {
  try {
    const doc = await getDB().get(id);
    if (doc.deleted || doc.trashed) return null;
    return doc;
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

const PUT_MAX_RETRY = 25;

export interface PutOptions {
  /** The _rev the editor loaded. If the stored doc has moved past it (a sync
   *  pulled a remote edit while the user was typing), the stored version is
   *  kept as a conflict sibling instead of being silently overwritten.
   *  A function is re-read on every attempt: the caller's idea of "the rev I
   *  have" can advance while this write is retrying. */
  baseRev?: string | (() => string | undefined);
  /** Carry the original creation time across a rename. */
  createdAt?: string;
  /** The caller stopped waiting for this write (timeout) and has moved on. If
   *  the write then loses a race (409) it must give up — retrying would put
   *  this older text on top of whatever was saved since. */
  abandoned?: () => boolean;
}

// Park a doc that is about to be overwritten under a sibling id. Deterministic
// id (rev only) so a retry after a 409 rewrites the same sibling.
async function parkDoc(doc: NoteDoc, kind: 'conflict' | 'trashed', extra: Partial<NoteDoc>): Promise<void> {
  const base = doc._id.replace(/\.md$/, '');
  const siblingId = `${base} (${kind}-${doc._rev}).md`;
  let siblingRev: string | undefined;
  try {
    siblingRev = (await getDB().get(siblingId))._rev;
  } catch (e: any) {
    if (e.status !== 404) throw e;
  }
  const { _rev, ...rest } = doc;
  void _rev;
  await getDB().put({ ...rest, ...extra, _id: siblingId, _rev: siblingRev });
}

/** Writes the note and returns its new _rev. */
export async function putNote(id: string, content: string, opts: PutOptions = {}): Promise<string> {
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < PUT_MAX_RETRY; attempt++) {
    // Read RAW (not via getNote) so legacy deleted: true docs are still seen — we
    // must attach the correct _rev to overwrite them.
    let existing: NoteDoc | null = null;
    try {
      existing = await getDB().get(id);
    } catch (e: any) {
      if (e.status !== 404) throw e;
    }
    const inTrash = !!existing && (!!existing.trashed || !!existing.deleted);
    const baseRev = typeof opts.baseRev === 'function' ? opts.baseRev() : opts.baseRev;
    if (existing && inTrash) {
      // Reusing the name of a trashed note must not destroy the trash copy.
      await parkDoc(existing, 'trashed', {
        trashed: true,
        trashedAt: existing.trashedAt ?? existing.updatedAt,
        deleted: undefined,
      });
    } else if (existing && baseRev && existing._rev !== baseRev && existing.content !== content) {
      await parkDoc(existing, 'conflict', { conflictOf: id });
    }
    const doc: NoteDoc = {
      _id: id,
      _rev: existing?._rev,
      content,
      title: extractTitle(content, id),
      tags: extractTags(content),
      links: extractLinks(content),
      createdAt: opts.createdAt ?? (inTrash ? now : existing?.createdAt ?? now),
      updatedAt: now,
    };
    try {
      const res = await getDB().put(doc);
      return res.rev;
    } catch (e: any) {
      if (e.status === 409 && opts.abandoned?.()) throw new Error('putNote: superseded by a later save');
      if (e.status === 409 && attempt < PUT_MAX_RETRY - 1) {
        // Random jitter (0–9 ms) prevents all concurrent callers from
        // re-reading _rev at exactly the same tick and colliding again.
        await new Promise(r => setTimeout(r, Math.floor(Math.random() * 10)));
        continue;
      }
      throw e;
    }
  }
  throw new Error('putNote: retries exhausted');
}

export async function deleteNote(id: string): Promise<void> {
  try {
    const doc = await getDB().get(id);
    await getDB().put({ ...doc, trashed: true, trashedAt: new Date().toISOString() });
  } catch (e: any) {
    if (e.status === 404) return;
    throw e;
  }
}

export async function restoreNote(id: string): Promise<void> {
  const doc = await getDB().get(id) as any;
  const { trashed, trashedAt, ...rest } = doc;
  void trashed; void trashedAt;
  await getDB().put(rest);
}

// Remove EVERY leaf revision, not just the winner. A doc can carry losing
// branches (a sync conflict not yet resolved — e.g. the other device edited the
// note this one trashed). Removing only the winner promotes a loser: "Delete
// forever" brought the note back, on every device.
//
// The winner goes first, at the exact revision that was read: if the note has
// moved since (restored, edited), that removal is refused (409) and NOTHING is
// touched — the losing branches of a note that is live again are someone's
// unresolved edits, not trash.
type Leaves = NoteDoc & { _rev: string; _conflicts?: string[] };
async function removeLeavesOf(doc: Leaves): Promise<void> {
  await getDB().remove(doc._id, doc._rev);
  for (const rev of doc._conflicts ?? []) {
    try { await getDB().remove(doc._id, rev); } catch (e: any) {
      if (e?.status !== 404 && e?.status !== 409) throw e;
    }
  }
}

async function removeAllLeaves(id: string): Promise<void> {
  await removeLeavesOf(await getDB().get(id, { conflicts: true }) as Leaves);
}

export async function purgeNote(id: string): Promise<void> {
  await removeAllLeaves(id);
}

// The trash panel works from a list that can be seconds old. Another tab or
// device may have restored (or already purged) the note since — "Delete forever"
// on that stale row used to wipe a LIVE note, irreversibly, on every device.
// These read the note at the moment of the click and act only on real trash —
// in ONE read: the write is pinned to the revision whose `trashed` flag was
// checked, so a restore landing in between makes it fail instead of slipping through.
export type TrashAction = 'done' | 'not-trashed' | 'gone';

async function onTrashed(id: string, act: (doc: Leaves) => Promise<void>): Promise<TrashAction> {
  for (let attempt = 0; ; attempt++) {
    let doc: Leaves;
    try {
      doc = await getDB().get(id, { conflicts: true }) as Leaves;
    } catch (e: any) {
      if (e?.status === 404) return 'gone';
      throw e;
    }
    if (!doc.trashed) return 'not-trashed';
    try {
      await act(doc);
      return 'done';
    } catch (e: any) {
      // moved under us — look again (it may be live now, or gone)
      if (e?.status === 409 && attempt < 3) continue;
      throw e;
    }
  }
}

export function purgeTrashed(id: string): Promise<TrashAction> {
  return onTrashed(id, removeLeavesOf);
}

export function restoreTrashed(id: string): Promise<TrashAction> {
  return onTrashed(id, async (doc) => {
    const { trashed, trashedAt, _conflicts, ...rest } = doc as Leaves & { trashedAt?: string };
    void trashed; void trashedAt; void _conflicts;
    await getDB().put(rest);
  });
}

export async function listTrash(): Promise<NoteDoc[]> {
  const result = await getDB().allDocs({ include_docs: true });
  return result.rows
    .map(r => r.doc as NoteDoc | undefined)
    .filter((d): d is NoteDoc => !!d && !!d.trashed);
}

const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export async function sweepTrash(now: number = Date.now()): Promise<void> {
  const cutoff = now - TRASH_TTL_MS;
  const result = await getDB().allDocs({ include_docs: true });
  for (const row of result.rows) {
    const doc = row.doc as NoteDoc | undefined;
    if (!doc) continue;
    // 1. Legacy `deleted: true` → `trashed: true` (one-time migration on first sweep)
    if (doc.deleted && !doc.trashed) {
      const { deleted, ...rest } = doc as any;
      void deleted;
      await getDB().put({ ...rest, trashed: true, trashedAt: doc.updatedAt });
      continue;
    }
    // 2. Old trash → physical remove
    if (doc.trashed && doc.trashedAt && Date.parse(doc.trashedAt) < cutoff) {
      // re-checked at removal: a note restored since this list was read stays
      await purgeTrashed(doc._id);
    }
  }
}

export async function listNotes(): Promise<NoteDoc[]> {
  const result = await getDB().allDocs({ include_docs: true });
  return result.rows
    .map(r => r.doc!)
    .filter(d => d && !d.trashed && !d.deleted && !d.conflictOf);
}

// Build FileEntry tree from flat note list (for compatibility with existing components)
export function buildFileTree(notes: NoteDoc[]): FileEntry[] {
  const root: FileEntry[] = [];
  const dirs = new Map<string, FileEntry>();

  for (const note of notes) {
    const parts = note._id.split('/');
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join('/');
      let dir = dirs.get(dirPath);
      if (!dir) {
        dir = { name: parts[i], path: dirPath, kind: 'directory', children: [] };
        dirs.set(dirPath, dir);
        current.push(dir);
      }
      current = dir.children!;
    }

    current.push({
      name: parts[parts.length - 1],
      path: note._id,
      kind: 'file',
      modified: note.updatedAt,
    });
  }

  // Sort: directories first, then alphabetically
  function sortEntries(entries: FileEntry[]): FileEntry[] {
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const e of entries) {
      if (e.children) sortEntries(e.children);
    }
    return entries;
  }

  return sortEntries(root);
}

/** Conflict siblings (losing sync revisions, colliding imports). listNotes() hides these. */
export async function listConflictSiblings(): Promise<NoteDoc[]> {
  const result = await getDB().allDocs({ include_docs: true });
  return result.rows
    .map(r => r.doc as NoteDoc | undefined)
    .filter((d): d is NoteDoc => !!d && !!d.conflictOf && !d.trashed && !d.deleted);
}

export async function listConflicts(): Promise<NoteDoc[]> {
  // Trashed winners are included on purpose: when "trash" beats an offline edit
  // made elsewhere, that edit sits in a losing revision. Skipping the doc hid it
  // from everyone, with no conflict copy and no notice.
  const result = await getDB().allDocs({ include_docs: true, conflicts: true });
  return result.rows
    .map(r => r.doc as (NoteDoc & { _conflicts?: string[] }) | undefined)
    .filter((d): d is NoteDoc & { _conflicts: string[] } => !!d && Array.isArray((d as any)._conflicts) && (d as any)._conflicts.length > 0);
}

/**
 * Turn the losing revisions of `id` into separate notes and drop them from the
 * revision tree. Returns the ids of the copies it created.
 *
 * Every device resolves the same conflict on its own, at the same time. So each
 * step must give the same result everywhere, or the copies themselves conflict
 * and breed copies of copies (one conflict used to become dozens):
 *  • the copy is written once, with fields taken only from the losing revision
 *    — same id, same body → same first revision on every device;
 *  • a copy that already exists is left alone;
 *  • a losing revision that says nothing new (same text as the winner) is just
 *    dropped — this is also what ends a conflict between two copies.
 */
export async function resolveConflict(id: string): Promise<string[]> {
  const winning = await getDB().get(id, { conflicts: true } as any) as NoteDoc & { _conflicts?: string[] };
  const conflicts = winning._conflicts;
  if (!conflicts?.length) return [];
  const winningGone = !!winning.trashed || !!winning.deleted;
  const base = id.replace(/\.md$/, '');
  const siblings: string[] = [];
  for (const rev of conflicts) {
    const losing = await getDB().get(id, { rev }) as NoteDoc;
    const losingGone = !!losing.trashed || !!losing.deleted;
    const sameText = typeof losing.content !== 'string' || losing.content === winning.content;
    if (!sameText || (winningGone && !losingGone)) {
      // A live edit that lost (to another edit, or to a trash) becomes a
      // conflict copy; a trashed version that lost stays in the trash.
      const kind = losingGone ? 'trashed' : 'conflict';
      const siblingId = `${base} (${kind}-${rev}).md`;
      const copy: NoteDoc = {
        _id: siblingId,
        content: losing.content,
        title: losing.title,
        tags: losing.tags,
        links: losing.links,
        createdAt: losing.createdAt,
        updatedAt: losing.updatedAt,
        ...(losingGone
          ? { trashed: true, trashedAt: losing.trashedAt ?? losing.updatedAt }
          : { conflictOf: winning.conflictOf ?? id }),
      };
      try {
        await getDB().put(copy);
        siblings.push(siblingId);
      } catch (e: any) {
        if (e.status !== 409) throw e; // 409: the copy is already there
      }
    }
    await getDB().remove(id, rev);
  }
  return siblings;
}

export async function atomicRename(oldPath: string, newPath: string): Promise<void> {
  if (oldPath === newPath) return;
  // Reserve check: destination must not exist as a visible note.
  const destExisting = await getNote(newPath);
  if (destExisting) throw new Error('Destination exists');
  const source = await getNote(oldPath);
  if (!source) throw new Error('Source not found');

  // Phase 1: copy to new path.
  await putNote(newPath, source.content, { createdAt: source.createdAt });

  // Phase 2: remove the old id. A rename is not a delete, so it must not leave a 30-day trash
  // entry behind — the content lives on under the new name. The PouchDB tombstone replicates
  // like any deletion; if a sync peer edited the old id meanwhile, its live revision wins and
  // the note simply reappears there. On failure, roll back by purging the new copy.
  try {
    await purgeNote(oldPath);
  } catch (e) {
    try { await purgeNote(newPath); } catch { /* best-effort rollback */ }
    throw e;
  }

  // Conflict copies point at their original by id. Left on the old id, "open
  // original" on them did nothing after a rename.
  try {
    for (const sibling of await listConflictSiblings()) {
      if (sibling.conflictOf === oldPath) await getDB().put({ ...sibling, conflictOf: newPath });
    }
  } catch (e) {
    console.error('Re-pointing conflict copies failed:', e);
  }
}

// Watch for changes (used to replace 3s filesystem polling)
export function watchChanges(cb: (doc: NoteDoc) => void): { cancel: () => void } {
  const changes = getDB().changes({
    since: 'now',
    live: true,
    include_docs: true,
  });
  changes.on('change', (change) => {
    if (change.doc) cb(change.doc as NoteDoc);
  });
  return { cancel: () => changes.cancel() };
}
