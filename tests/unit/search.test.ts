import { describe, it, expect, beforeEach } from 'vitest';
import { indexFile, clearIndex, removeFromIndex, search } from '../../src/lib/search';

beforeEach(() => clearIndex());

describe('search index', () => {
  it('finds documents by exact token', () => {
    indexFile('a.md', 'hello world');
    indexFile('b.md', 'goodbye world');
    const hits = search('hello');
    expect(hits.map(h => h.id)).toContain('a.md');
  });

  it('finds via prefix', () => {
    indexFile('a.md', 'helicopter');
    const hits = search('heli');
    expect(hits.map(h => h.id)).toContain('a.md');
  });

  it('removes from index', () => {
    indexFile('a.md', 'hello');
    removeFromIndex('a.md');
    const hits = search('hello');
    expect(hits.map(h => h.id)).not.toContain('a.md');
  });

  it('clearIndex empties everything', () => {
    indexFile('a.md', 'hello');
    indexFile('b.md', 'world');
    clearIndex();
    expect(search('hello').length).toBe(0);
    expect(search('world').length).toBe(0);
  });
});
