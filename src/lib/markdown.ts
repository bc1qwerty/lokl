import { Marked } from 'marked';
import { allFilePaths, backlinksIndex, wikilinksIndex } from './store';

// --- Wiki-link regex ---
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

// --- Link resolution ---

export function resolveWikiLink(linkText: string): string | null {
  const target = linkText.split('|')[0].trim();
  const paths = allFilePaths.value;

  // Exact match (with .md)
  const withExt = target.endsWith('.md') ? target : `${target}.md`;
  const exact = paths.find((p) => p === withExt);
  if (exact) return exact;

  // Match by filename only
  const byName = paths.find((p) => {
    const name = p.split('/').pop()?.replace(/\.md$/, '');
    return name === target;
  });
  if (byName) return byName;

  // Match by path ending
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

// --- Build backlinks index ---

export function updateLinksForFile(filePath: string, content: string) {
  const links = extractWikiLinks(content);
  const resolved = links
    .map((l) => resolveWikiLink(l))
    .filter((p): p is string => p !== null);

  // Update wikilinks index
  const wl = new Map(wikilinksIndex.value);
  wl.set(filePath, resolved);
  wikilinksIndex.value = wl;

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
          return {
            type: 'wikilink',
            raw: match[0],
            text: match[1],
          };
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
  return marked.parse(content) as string;
}
