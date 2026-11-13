import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyLinkChanges, setAllLinks, resetLinkIndex, resolveWikiLink,
  extractWikiLinks, extractTags,
} from '../../src/lib/markdown';
import { backlinksIndex, wikilinksIndex, tagsIndex, fileTree } from '../../src/lib/store';
import { safeNoteId } from '../../src/lib/note-path';
import type { FileEntry } from '../../src/types';

// The index is updated incrementally (only changed notes are parsed again). These
// tests hold it to the plain definition: resolve every link of every note against
// the full list of paths, the slow way, and compare.

function setPaths(paths: string[]) {
  fileTree.value = paths.map((p): FileEntry => ({ kind: 'file', path: p, name: p.split('/').pop() || p }));
}

// Reference resolution — the original `paths.find` scans, plus the "_" fallback.
function refResolve(paths: string[], linkText: string): string | null {
  const scan = (target: string) => {
    const withExt = target.endsWith('.md') ? target : `${target}.md`;
    return paths.find((p) => p === withExt)
      ?? paths.find((p) => p.split('/').pop()?.replace(/\.md$/, '') === target)
      ?? paths.find((p) => p.endsWith(`/${withExt}`))
      ?? null;
  };
  const target = linkText.split('|')[0].trim();
  return scan(target) ?? (safeNoteId(target) !== target ? scan(safeNoteId(target)) : null);
}

function reference(notes: Map<string, string>, paths: string[]) {
  const wl = new Map<string, string[]>();
  const bl = new Map<string, string[]>();
  const tags = new Map<string, string[]>();
  for (const [id, content] of notes) {
    const resolved = extractWikiLinks(content).map((l) => refResolve(paths, l)).filter((p): p is string => p !== null);
    wl.set(id, resolved);
    for (const t of resolved) bl.set(t, [...(bl.get(t) ?? []), id]);
    for (const tag of extractTags(content)) tags.set(tag, [...(tags.get(tag) ?? []), id]);
  }
  return { wl, bl, tags };
}

const sorted = (m: Map<string, Iterable<string>>, dedupe = false) =>
  [...m].map(([k, v]) => [k, dedupe ? [...new Set(v)].sort() : [...v]] as const).sort((a, b) => a[0].localeCompare(b[0]));

function expectMatches(notes: Map<string, string>, paths: string[]) {
  const ref = reference(notes, paths);
  expect(sorted(wikilinksIndex.value)).toEqual(sorted(ref.wl));
  expect(sorted(backlinksIndex.value, true)).toEqual(sorted(ref.bl, true));
  expect(sorted(tagsIndex.value, true)).toEqual(sorted(ref.tags, true));
}

// small deterministic PRNG (mulberry32)
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => {
  fileTree.value = [];
  resetLinkIndex();
});

describe('link resolution', () => {
  it('resolves by exact path, by file name, by path suffix — in that order', () => {
    setPaths(['z/note.md', 'note.md', 'a/b/deep.md', 'x/deep.md']);
    expect(resolveWikiLink('note')).toBe('note.md');          // exact beats the earlier z/note.md
    expect(resolveWikiLink('deep')).toBe('a/b/deep.md');      // first by name
    expect(resolveWikiLink('b/deep')).toBe('a/b/deep.md');    // by suffix
    expect(resolveWikiLink('x/deep.md|shown')).toBe('x/deep.md');
    expect(resolveWikiLink('missing')).toBeNull();
  });

  it('a different-case spelling resolves only when exactly one note matches; exact spelling wins', () => {
    setPaths(['Projects/Plan.md', 'todo.md', 'Todo.md', 'solo.md']);
    expect(resolveWikiLink('plan')).toBe('Projects/Plan.md');
    expect(resolveWikiLink('projects/plan')).toBe('Projects/Plan.md');
    expect(resolveWikiLink('SOLO')).toBe('solo.md');
    expect(resolveWikiLink('Todo')).toBe('Todo.md');   // exact
    expect(resolveWikiLink('todo')).toBe('todo.md');   // exact
    expect(resolveWikiLink('TODO')).toBeNull();        // two candidates — do not guess
  });

  it('[[Note#Heading]] opens the note; a note literally named with "#" still wins', () => {
    setPaths(['guide.md', 'a#b.md']);
    expect(resolveWikiLink('guide#Install')).toBe('guide.md');
    expect(resolveWikiLink('Guide#Install|how to')).toBe('guide.md');
    expect(resolveWikiLink('a#b')).toBe('a#b.md');
    expect(resolveWikiLink('missing#x')).toBeNull();
    expect(resolveWikiLink('#only-heading')).toBeNull();
  });

  it('a link to a name that began with "_" finds the note stored under "-"', () => {
    // import turns _index.md into -index.md; [[_index]] written before must still open it
    setPaths(['-index.md', '-templates/daily.md', 'a.md']);
    expect(resolveWikiLink('_index')).toBe('-index.md');
    expect(resolveWikiLink('_templates/daily')).toBe('-templates/daily.md');
    expect(resolveWikiLink('_nope')).toBeNull();
  });
});

describe('incremental index equals a full recompute', () => {
  const NAMES = ['a', 'b', 'c', 'd', 'dir/a', 'dir/e', 'dir/sub/f', 'x/f', '-index', 'g h', 'z'];
  const LINKS = ['a', 'b', 'c', 'dir/a', 'e', 'f', 'sub/f', 'x/f', '_index', '-index', 'g h', 'nope', 'z|alias', 'dir/e.md'];
  const TAGS = ['alpha', 'beta', 'gamma', 'x/y'];

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`random change sequence, seed ${seed}`, () => {
      const rand = rng(seed);
      const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
      const body = () => {
        let s = 'text';
        for (let i = Math.floor(rand() * 4); i > 0; i--) s += ` [[${pick(LINKS)}]]`;
        for (let i = Math.floor(rand() * 3); i > 0; i--) s += ` #${pick(TAGS)}`;
        return s;
      };
      const notes = new Map<string, string>();
      const paths = () => [...notes.keys()].sort();
      let shown: string[] = [];

      for (let step = 0; step < 300; step++) {
        // a burst of 1–4 changes, then one index update — as the change feed does
        const changes = new Map<string, string | null>();
        for (let n = 1 + Math.floor(rand() * 4); n > 0; n--) {
          const id = `${pick(NAMES)}.md`;
          const roll = rand();
          if (roll < 0.25 && notes.has(id)) { notes.delete(id); changes.set(id, null); }
          else if (roll < 0.35 && notes.has(id)) {
            // rename: gone under one id, back under another
            const to = `${pick(NAMES)}.md`;
            if (!notes.has(to)) { const c = notes.get(id)!; notes.delete(id); notes.set(to, c); changes.set(id, null); changes.set(to, c); }
          } else { const c = body(); notes.set(id, c); changes.set(id, c); }
        }
        // The tree is rebuilt only when a note appeared or vanished — an edit-only
        // burst keeps the same path list, and must take the incremental branch.
        const now = paths();
        if (now.join('\n') !== shown.join('\n')) { shown = now; setPaths(now); }
        // every third update also hands over the authoritative list (tree rebuilt)
        const live = step % 3 === 0 ? [...notes].map(([_id, content]) => ({ _id, content })) : undefined;
        applyLinkChanges(changes, live);
        expectMatches(notes, paths());
      }
    });
  }

  it('reconciles against the authoritative list when the feed missed changes', () => {
    const notes = new Map([['a.md', '[[b]] #t'], ['b.md', 'x']]);
    setPaths(['a.md', 'b.md']);
    setAllLinks([...notes].map(([_id, content]) => ({ _id, content })));
    // b vanished and c appeared without a feed event
    notes.delete('b.md'); notes.set('c.md', '[[a]] #u');
    setPaths(['a.md', 'c.md']);
    applyLinkChanges([], [...notes].map(([_id, content]) => ({ _id, content })));
    expectMatches(notes, ['a.md', 'c.md']);
  });

  it('a save that changes neither links nor tags leaves the signals untouched', () => {
    setPaths(['a.md', 'b.md']);
    setAllLinks([{ _id: 'a.md', content: 'x [[b]] #t' }, { _id: 'b.md', content: 'y' }]);
    const wl = wikilinksIndex.value, bl = backlinksIndex.value, tg = tagsIndex.value;
    applyLinkChanges([['a.md', 'more words [[b]] #t']]);
    expect(wikilinksIndex.value).toBe(wl);
    expect(backlinksIndex.value).toBe(bl);
    expect(tagsIndex.value).toBe(tg);
  });
});

describe('index cost in a large vault', () => {
  // 3,000 notes: an autosave used to cost ~1.2 s of main thread here (every note
  // re-resolved by list scan, every backlink rebuilt per note).
  const N = 3000;
  function vault() {
    const notes: Array<{ _id: string; content: string }> = [];
    for (let i = 0; i < N; i++) {
      notes.push({
        _id: `dir${i % 40}/note-${i}.md`,
        content: `# note ${i}\n[[note-${(i * 7) % N}]] [[dir${((i * 13) % N) % 40}/note-${(i * 13) % N}]] [[note-${(i + 1) % N}]] [[missing-${i}]] #tag${i % 25} #all\n` + 'lorem ipsum '.repeat(40),
      });
    }
    return notes;
  }
  const ms = (fn: () => void) => { const t = performance.now(); fn(); return performance.now() - t; };

  it('one changed note is re-indexed in milliseconds, a new note in well under a frame budget of old', () => {
    const notes = vault();
    setPaths(notes.map((n) => n._id));
    const load = ms(() => setAllLinks(notes));
    expect(wikilinksIndex.value.size).toBe(N);
    expect(wikilinksIndex.value.get('dir0/note-0.md')!.length).toBe(3);

    // autosave: same links, new text
    const same = ms(() => applyLinkChanges([[notes[5]._id, notes[5].content + ' typed more']]));
    // autosave that adds a link
    const linked = ms(() => applyLinkChanges([[notes[6]._id, notes[6].content + ' [[note-9]]']]));
    // a note arrives: every stored link is resolved again
    const fresh = { _id: 'dir3/brand-new.md', content: '[[note-1]] #all' };
    setPaths([...notes.map((n) => n._id), fresh._id]);
    const added = ms(() => applyLinkChanges([[fresh._id, fresh.content]]));
    expect(backlinksIndex.value.get('dir1/note-1.md')!.has(fresh._id)).toBe(true);

    // Budgets are several times what this takes on a laptop (≈1 / 5 / 25 / 60 ms),
    // far below the old cost, so a slow CI runner does not flake.
    if (process.env.LOKL_PERF_LOG) console.log({ load, same, linked, added });
    expect(same).toBeLessThan(50);
    expect(linked).toBeLessThan(100);
    expect(added).toBeLessThan(400);
    expect(load).toBeLessThan(1500);
  });
});
