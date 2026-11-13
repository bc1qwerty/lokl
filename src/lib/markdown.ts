import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { allFilePaths, backlinksIndex, wikilinksIndex, tagsIndex } from './store';
import type { Frontmatter } from '../types';
import { safeNoteId } from './note-path';

// --- Wiki-link regex ---
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const TAG_RE = /(?:^|\s)#([a-zA-Z\u00C0-\u024F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\w][a-zA-Z\u00C0-\u024F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\w/-]*)/g;

// --- Frontmatter parsing ---

export function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(content);
  if (!match) return { frontmatter: {}, body: content };

  const raw = match[1];
  const fm: Frontmatter = {};
  for (const line of raw.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      fm[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
    } else {
      fm[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  return { frontmatter: fm, body: content.slice(match[0].length) };
}

// --- Link resolution ---

// Lookup tables for one list of paths. Resolution used to scan the whole list
// (`paths.find`) for every link; re-resolving a 3,000-note vault that way was
// millions of string comparisons on the main thread.
interface Resolver {
  exact: Set<string>;
  byName: Map<string, string>;    // "note"        -> first path whose file name is note.md
  bySuffix: Map<string, string>;  // "dir/note.md" -> first path ending in /dir/note.md
}

function buildResolver(paths: string[]): Resolver {
  const exact = new Set(paths);
  const byName = new Map<string, string>();
  const bySuffix = new Map<string, string>();
  for (const p of paths) {
    const name = (p.split('/').pop() ?? '').replace(/\.md$/, '');
    if (!byName.has(name)) byName.set(name, p);
    for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) {
      const suffix = p.slice(i + 1);
      if (!bySuffix.has(suffix)) bySuffix.set(suffix, p);
    }
  }
  return { exact, byName, bySuffix };
}

let cachedPaths: string[] | null = null;
let cachedResolver: Resolver = buildResolver([]);
function resolverFor(paths: string[]): Resolver {
  if (paths !== cachedPaths) {
    cachedPaths = paths;
    cachedResolver = buildResolver(paths);
  }
  return cachedResolver;
}

function lookup(r: Resolver, target: string): string | null {
  const withExt = target.endsWith('.md') ? target : `${target}.md`;
  if (r.exact.has(withExt)) return withExt;
  return r.byName.get(target) ?? r.bySuffix.get(withExt) ?? null;
}

function resolveWith(r: Resolver, linkText: string): string | null {
  const target = linkText.split('|')[0].trim();
  const hit = lookup(r, target);
  if (hit) return hit;
  // A note whose name began with "_" is stored with "-" instead (PouchDB cannot
  // hold "_" ids). Links written against the old name — [[_index]] — must keep working.
  const safe = safeNoteId(target);
  return safe !== target ? lookup(r, safe) : null;
}

export function resolveWikiLink(linkText: string): string | null {
  return resolveWith(resolverFor(allFilePaths.value), linkText);
}

export function getDisplayText(linkText: string): string {
  const parts = linkText.split('|');
  if (parts.length > 1) return parts[1].trim();
  const target = parts[0].trim();
  return target.split('/').pop()?.replace(/\.md$/, '') || target;
}

// --- Extract wiki-links from content ---

export function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  let match;
  const re = new RegExp(WIKILINK_RE.source, 'g');
  while ((match = re.exec(content)) !== null) {
    links.push(match[1].split('|')[0].trim());
  }
  return links;
}

// --- Extract tags from content ---

export function extractTags(content: string): string[] {
  const { frontmatter, body } = parseFrontmatter(content);
  const tags = new Set<string>();

  // From frontmatter
  if (Array.isArray(frontmatter.tags)) {
    for (const t of frontmatter.tags) tags.add(String(t).toLowerCase());
  }

  // From inline #tags (skip code blocks)
  const cleaned = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  let match;
  const re = new RegExp(TAG_RE.source, 'g');
  while ((match = re.exec(cleaned)) !== null) {
    tags.add(match[1].toLowerCase());
  }

  return Array.from(tags);
}

// --- Build backlinks + tags index ---

// What each note says, kept apart from what it resolves to: a link is resolved
// against the list of existing notes, so when that list changes every note has
// to be resolved again — from here, without reading any note content again.
const rawLinks = new Map<string, string[]>();
const fileTags = new Map<string, string[]>();
// The path list the stored resolutions were made against. If the file tree has
// been rebuilt since, everything is resolved again (cheap with the lookup tables).
let resolvedAgainst: string[] | null = null;

/** Forget everything (tests, and before a full reload of the vault). */
export function resetLinkIndex(): void {
  rawLinks.clear();
  fileTags.clear();
  resolvedAgainst = null;
  wikilinksIndex.value = new Map();
  tagsIndex.value = new Map();
  backlinksIndex.value = new Map();
}

const sameList = (a: string[] | undefined, b: string[]) =>
  !!a && a.length === b.length && a.every((x, i) => x === b[i]);

export interface LinkNote { _id: string; content: string }

/**
 * Apply a batch of note changes (`null` = the note is gone) to the link, backlink
 * and tag indexes — one pass, signals assigned once.
 *
 * It used to be one updateLinksForFile() per note, each copying both maps and
 * rebuilding every backlink: O(n²) per change burst, and the change feed sent
 * every autosave through it (1.2 s of frozen typing at 3,000 notes).
 *
 * `live`, when given, is the authoritative list of notes: entries the index
 * holds for notes no longer in it are dropped, notes it lacks are added.
 */
export function applyLinkChanges(
  changes: Iterable<readonly [string, string | null]>,
  live?: LinkNote[],
): void {
  const paths = allFilePaths.value;
  const resolver = resolverFor(paths);
  const touched = new Set<string>();
  // A note appeared or vanished: other notes' links may resolve differently.
  let structural = paths !== resolvedAgainst;
  resolvedAgainst = paths;

  const tags = new Map(tagsIndex.value);
  let tagsChanged = false;
  const setTags = (path: string, next: string[]) => {
    const prev = fileTags.get(path) ?? [];
    if (sameList(prev, next)) return;
    tagsChanged = true;
    for (const tag of prev) {
      const left = new Set(tags.get(tag));
      left.delete(path);
      if (left.size === 0) tags.delete(tag); else tags.set(tag, left);
    }
    for (const tag of next) tags.set(tag, new Set(tags.get(tag)).add(path));
    if (next.length) fileTags.set(path, next); else fileTags.delete(path);
  };
  const drop = (path: string) => {
    if (rawLinks.delete(path)) structural = true;
    setTags(path, []);
    touched.add(path);
  };
  const put = (path: string, content: string) => {
    if (!rawLinks.has(path)) structural = true;
    rawLinks.set(path, extractWikiLinks(content));
    setTags(path, extractTags(content));
    touched.add(path);
  };

  for (const [path, content] of changes) {
    if (content === null) drop(path); else put(path, content);
  }
  if (live) {
    const ids = new Set(live.map((n) => n._id));
    for (const path of [...rawLinks.keys()]) if (!ids.has(path)) drop(path);
    for (const n of live) if (!rawLinks.has(n._id) && typeof n.content === 'string') put(n._id, n.content);
  }

  const prevWl = wikilinksIndex.value;
  const wl = new Map(prevWl);
  let linksChanged = false;
  const resolveInto = (path: string) => {
    const raw = rawLinks.get(path);
    if (!raw) {
      if (wl.delete(path)) linksChanged = true;
      return;
    }
    const resolved: string[] = [];
    for (const l of raw) {
      const hit = resolveWith(resolver, l);
      if (hit !== null) resolved.push(hit);
    }
    if (!sameList(prevWl.get(path), resolved)) {
      wl.set(path, resolved);
      linksChanged = true;
    }
  };
  if (structural) {
    for (const path of [...wl.keys()]) if (!rawLinks.has(path)) { wl.delete(path); linksChanged = true; }
    for (const path of rawLinks.keys()) resolveInto(path);
  } else {
    for (const path of touched) resolveInto(path);
  }

  // Assign only what changed: panels re-render on every assignment, and most
  // saves change neither a link nor a tag.
  if (tagsChanged) tagsIndex.value = tags;
  if (linksChanged) {
    wikilinksIndex.value = wl;
    rebuildBacklinks();
  }
}

/** Rebuild everything from a full list of notes (vault load). */
export function setAllLinks(notes: LinkNote[]): void {
  resetLinkIndex();
  applyLinkChanges([], notes);
}

export function updateLinksForFile(filePath: string, content: string) {
  applyLinkChanges([[filePath, content]]);
}

function rebuildBacklinks() {
  const bl = new Map<string, Set<string>>();
  for (const [source, targets] of wikilinksIndex.value) {
    for (const target of targets) {
      if (!bl.has(target)) bl.set(target, new Set());
      bl.get(target)!.add(source);
    }
  }
  backlinksIndex.value = bl;
}

// --- Marked renderer with wiki-links ---

const marked = new Marked();

marked.use({
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start(src: string) {
        return src.indexOf('[[');
      },
      tokenizer(src: string) {
        const match = /^\[\[([^\]]+)\]\]/.exec(src);
        if (match) {
          return { type: 'wikilink', raw: match[0], text: match[1] };
        }
        return undefined;
      },
      renderer(token: any) {
        const resolved = resolveWikiLink(token.text);
        const display = getDisplayText(token.text);
        const cls = resolved ? 'wikilink' : 'wikilink wikilink-broken';
        const path = resolved || '';
        return `<a class="${cls}" data-wikilink="${path}" href="#">${display}</a>`;
      },
    },
  ],
});

export function renderMarkdown(content: string): string {
  const { body } = parseFrontmatter(content);
  const html = marked.parse(body) as string;
  return DOMPurify.sanitize(html);
}
