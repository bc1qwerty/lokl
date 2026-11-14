import { describe, it, expect, beforeEach } from 'vitest';
import { updateLinksForFile, resetLinkIndex, resolveWikiLink, renderMarkdown } from '../../src/lib/markdown';
import { backlinksIndex, wikilinksIndex, fileTree } from '../../src/lib/store';
import type { FileEntry } from '../../src/types';

// Helper: populate allFilePaths (computed from fileTree) so resolveWikiLink can resolve targets
function setKnownFiles(...paths: string[]) {
  fileTree.value = paths.map((p): FileEntry => ({ kind: 'file', path: p, name: p.split('/').pop() || p }));
}

beforeEach(() => {
  fileTree.value = [];
  resetLinkIndex();
});

describe('markdown link indexing', () => {
  it('records outgoing wikilinks for known files', () => {
    setKnownFiles('b.md', 'c.md');
    updateLinksForFile('a.md', 'see [[b]] and [[c|display]]');

    const links = wikilinksIndex.value.get('a.md');
    expect(links).toBeDefined();
    expect(links).toContain('b.md');
    expect(links).toContain('c.md');
  });

  it('does not record wikilinks for unknown targets', () => {
    // No files registered — resolveWikiLink returns null for all
    updateLinksForFile('a.md', 'see [[missing]]');

    const links = wikilinksIndex.value.get('a.md');
    // Entry exists but resolved list is empty
    expect(links).toBeDefined();
    expect(links!.length).toBe(0);
  });

  it('builds backlinks from multiple sources', () => {
    setKnownFiles('b.md');
    updateLinksForFile('a.md', '[[b]]');
    updateLinksForFile('c.md', '[[b]]');

    const back = backlinksIndex.value.get('b.md');
    expect(back).toBeDefined();
    const arr = back instanceof Set ? [...back] : Array.isArray(back) ? back : [];
    expect(arr.sort()).toEqual(['a.md', 'c.md']);
  });

  it('removes stale backlinks when source content changes', () => {
    setKnownFiles('b.md');
    updateLinksForFile('a.md', '[[b]]');
    updateLinksForFile('a.md', 'no links');

    const back = backlinksIndex.value.get('b.md');
    const arr = back instanceof Set ? [...back] : Array.isArray(back) ? back : [];
    expect(arr).not.toContain('a.md');
  });
});

describe('unicode form', () => {
  it('a typed [[link]] finds a note whose id was imported decomposed (NFD), and the reverse', () => {
    const nfd = '한글노트.md'.normalize('NFD');
    setKnownFiles(nfd, 'sub/café.md');
    expect(resolveWikiLink('한글노트')).toBe(nfd);
    expect(resolveWikiLink('한글노트.md')).toBe(nfd);
    expect(resolveWikiLink('café'.normalize('NFD'))).toBe('sub/café.md');
  });
});

describe('rendered links', () => {
  it('an external link opens in a new tab; a wiki-link stays in the app', () => {
    setKnownFiles('a.md');
    const html = renderMarkdown('[site](https://example.com) and [[a]] and [rel](other.md)');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const [ext, wiki, rel] = Array.from(doc.querySelectorAll('a'));
    expect(ext.getAttribute('target')).toBe('_blank');
    expect(ext.getAttribute('rel')).toBe('noopener noreferrer');
    expect(wiki.hasAttribute('target')).toBe(false);
    expect(rel.hasAttribute('target')).toBe(false);
  });
});
