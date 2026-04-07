import PouchDB from 'pouchdb-browser';
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
  deleted?: boolean;
}

let db: PouchDB.Database<NoteDoc>;

export function initDB(name = 'lokl'): PouchDB.Database<NoteDoc> {
  if (!db) {
    db = new PouchDB<NoteDoc>(name);
  }
  return db;
}

export function getDB(): PouchDB.Database<NoteDoc> {
  if (!db) return initDB();
  return db;
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
    if (doc.deleted) return null;
    return doc;
  } catch (e: any) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function putNote(id: string, content: string): Promise<void> {
  const now = new Date().toISOString();
  const title = extractTitle(content, id);
  const tags = extractTags(content);
  const links = extractLinks(content);

  try {
    const existing = await getDB().get(id);
    await getDB().put({
      _id: id,
      _rev: existing._rev,
      content,
      title,
      tags,
      links,
      createdAt: existing.createdAt || now,
      updatedAt: now,
    });
  } catch (e: any) {
    if (e.status === 404) {
      await getDB().put({
        _id: id,
        content,
        title,
        tags,
        links,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      throw e;
    }
  }
}

export async function deleteNote(id: string): Promise<void> {
  try {
    const doc = await getDB().get(id);
    await getDB().put({ ...doc, deleted: true, updatedAt: new Date().toISOString() });
  } catch (e: any) {
    if (e.status === 404) return;
    throw e;
  }
}

export async function listNotes(): Promise<NoteDoc[]> {
  const result = await getDB().allDocs({ include_docs: true });
  return result.rows
    .map(r => r.doc!)
    .filter(d => d && !d.deleted && d._id !== '_settings');
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
