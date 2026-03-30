import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { allFilePaths, backlinksIndex, wikilinksIndex, tagsIndex } from './store';
import type { Frontmatter } from '../types';

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

export function resolveWikiLink(linkText: string): string | null {
  const target = linkText.split('|')[0].trim();
  const paths = allFilePaths.value;

  const withExt = target.endsWith('.md') ? target : `${target}.md`;
  const exact = paths.find((p) => p === withExt);
  if (exact) return exact;

  const byName = paths.find((p) => {
    const name = p.split('/').pop()?.replace(/\.md$/, '');
    return name === target;
  });
  if (byName) return byName;

  const byEnd = paths.find((p) => p.endsWith(`/${withExt}`));
  if (byEnd) return byEnd;

  return null;
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

export function updateLinksForFile(filePath: string, content: string) {
  const links = extractWikiLinks(content);
  const resolved = links
    .map((l) => resolveWikiLink(l))
    .filter((p): p is string => p !== null);

  // Update wikilinks index
  const wl = new Map(wikilinksIndex.value);
  wl.set(filePath, resolved);
  wikilinksIndex.value = wl;

  // Update tags index
  const fileTags = extractTags(content);
  const ti = new Map(tagsIndex.value);
  // Remove old entries for this file
  for (const [tag, paths] of ti) {
    paths.delete(filePath);
    if (paths.size === 0) ti.delete(tag);
  }
  // Add new entries
  for (const tag of fileTags) {
    if (!ti.has(tag)) ti.set(tag, new Set());
    ti.get(tag)!.add(filePath);
  }
  tagsIndex.value = ti;

  rebuildBacklinks();
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
