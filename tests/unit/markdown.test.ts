import { describe, it, expect, beforeEach } from 'vitest';
import { updateLinksForFile } from '../../src/lib/markdown';
import { backlinksIndex, wikilinksIndex, fileTree } from '../../src/lib/store';
import type { FileEntry } from '../../src/types';

// Helper: populate allFilePaths (computed from fileTree) so resolveWikiLink can resolve targets
function setKnownFiles(...paths: string[]) {
  fileTree.value = paths.map((p): FileEntry => ({ kind: 'file', path: p, name: p.split('/').pop() || p }));
}

beforeEach(() => {
  fileTree.value = [];
  backlinksIndex.value = new Map();
  wikilinksIndex.value = new Map();
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
