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

  // MiniSearch's default vacuum rests between batches. clearIndex() in one of those rests swapped
  // the tree under it: "Cannot read properties of undefined (reading 'size')", uncaught.
  it('clearIndex during a vacuum does not throw', async () => {
    const errs: unknown[] = [];
    const onErr = (e: unknown) => { errs.push(e); };
    process.on('unhandledRejection', onErr);
    try {
      const body = (i: number, r: number) => Array.from({ length: 30 }, (_, k) => 'w' + ((r * 977 + i * 31 + k) * 7919 % 50000).toString(36)).join(' ');
      for (let i = 0; i < 4000; i++) indexFile(`n${i}.md`, body(i, 0));
      for (let i = 0; i < 1000; i++) indexFile(`n${i}.md`, body(i, 1));
      await new Promise(r => setTimeout(r, 5));
      clearIndex();
      for (let i = 0; i < 300; i++) indexFile(`m${i}.md`, body(i, 2));
      await new Promise(r => setTimeout(r, 600));
      expect(errs).toEqual([]);
      expect(search('m5').length).toBeGreaterThan(0);
    } finally {
      process.off('unhandledRejection', onErr);
    }
  });
  it('a typed query finds a title and a body stored decomposed (NFD)', () => {
    const nfd = '한글노트.md'.normalize('NFD');
    indexFile(nfd, '본문에는 café 가 있다'.normalize('NFD'));
    expect(search('한글노트').map(h => h.id)).toContain(nfd);
    expect(search('café').map(h => h.id)).toContain(nfd);
  });
});
