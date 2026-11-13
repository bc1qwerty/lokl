import { describe, it, expect } from 'vitest';
import { sortTree } from "../../src/lib/store";
import type { FileEntry } from '../../src/types';

// "Sort files by" in Settings was stored and shown as active but nothing read it.
const tree: FileEntry[] = [
  { name: 'b.md', path: 'b.md', kind: 'file', modified: '2026-01-03T00:00:00.000Z' },
  { name: 'a.md', path: 'a.md', kind: 'file', modified: '2026-01-01T00:00:00.000Z' },
  { name: 'dir', path: 'dir', kind: 'directory', children: [
    { name: 'y.md', path: 'dir/y.md', kind: 'file', modified: '2026-01-02T00:00:00.000Z' },
    { name: 'x.md', path: 'dir/x.md', kind: 'file', modified: '2026-01-09T00:00:00.000Z' },
  ] },
  { name: 'old', path: 'old', kind: 'directory', children: [
    { name: 'z.md', path: 'old/z.md', kind: 'file', modified: '2025-01-01T00:00:00.000Z' },
  ] },
  { name: 'c.md', path: 'c.md', kind: 'file', modified: '2026-01-02T00:00:00.000Z' },
];
const flat = (es: FileEntry[]): string[] => es.flatMap((e) => [e.path, ...(e.children ? flat(e.children) : [])]);

describe('sortTree', () => {
  it('by name: directories first, then alphabetical', () => {
    expect(flat(sortTree(tree, 'name'))).toEqual(['dir', 'dir/x.md', 'dir/y.md', 'old', 'old/z.md', 'a.md', 'b.md', 'c.md']);
  });

  it('by modified: newest first, a folder counts as its newest note', () => {
    expect(flat(sortTree(tree, 'modified'))).toEqual(['dir', 'dir/x.md', 'dir/y.md', 'old', 'old/z.md', 'b.md', 'c.md', 'a.md']);
  });

  it('does not reorder the tree it was given', () => {
    const before = flat(tree);
    sortTree(tree, 'modified');
    expect(flat(tree)).toEqual(before);
  });
});

import { withModified } from '../../src/lib/store';

// "Sort files by: Modified" did not follow saves: the tree (and its `modified` times) was only
// rebuilt when a note appeared or vanished.
describe('withModified', () => {
  it('replaces the time of the touched notes, at any depth, so the order follows the save', () => {
    const next = withModified(tree, new Map([['a.md', '2026-02-01T00:00:00.000Z'], ['old/z.md', '2026-03-01T00:00:00.000Z']]));
    expect(flat(sortTree(next, 'modified'))).toEqual(['old', 'old/z.md', 'dir', 'dir/x.md', 'dir/y.md', 'a.md', 'b.md', 'c.md']);
  });

  it('returns the same array when nothing changed (no re-render for a no-op)', () => {
    expect(withModified(tree, new Map())).toBe(tree);
    expect(withModified(tree, new Map([['b.md', '2026-01-03T00:00:00.000Z'], ['gone.md', '2027-01-01T00:00:00.000Z']]))).toBe(tree);
  });

  it('does not change the tree it was given', () => {
    const before = JSON.stringify(tree);
    withModified(tree, new Map([['a.md', '2030-01-01T00:00:00.000Z']]));
    expect(JSON.stringify(tree)).toBe(before);
  });
});
