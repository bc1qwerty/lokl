import { describe, it, expect } from 'vitest';
import { normalizeNotePath, safeNoteId, withExistingFolders } from '../../src/lib/note-path';

describe('normalizeNotePath', () => {
  it('appends .md and keeps ordinary names', () => {
    expect(normalizeNotePath('todo')).toBe('todo.md');
    expect(normalizeNotePath('journal/day.md')).toBe('journal/day.md');
    expect(normalizeNotePath('  spaced name  ')).toBe('spaced name.md');
  });

  it('never yields empty, dot or parent segments', () => {
    expect(normalizeNotePath('/lead')).toBe('lead.md');
    expect(normalizeNotePath('trail/')).toBe('trail.md');
    expect(normalizeNotePath('x/../y')).toBe('y.md');
    expect(normalizeNotePath('a//b/./c')).toBe('a/b/c.md');
    expect(normalizeNotePath('a\\b')).toBe('a/b.md');
    expect(normalizeNotePath('../../up')).toBe('up.md');
  });

  it('returns null when nothing usable is left', () => {
    for (const bad of ['', '   ', '/', '//', '..', 'a/..', '.', '.md']) expect(normalizeNotePath(bad)).toBeNull();
  });

  it('swaps a leading underscore the database would refuse', () => {
    expect(normalizeNotePath('_index')).toBe('-index.md');
    expect(normalizeNotePath('__x/y')).toBe('--x/y.md');
    // only the very start of the id is reserved
    expect(normalizeNotePath('notes/_index')).toBe('notes/_index.md');
  });
});

describe('unicode form', () => {
  it('a decomposed (Mac file name) spelling becomes the composed one', () => {
    const nfd = '한글노트'.normalize('NFD');
    expect(nfd).not.toBe('한글노트');
    expect(normalizeNotePath(nfd)).toBe('한글노트.md');
    expect(normalizeNotePath(`dir/${'café'.normalize('NFD')}`)).toBe('dir/café.md');
  });
});

describe('safeNoteId', () => {
  it('touches only a leading underscore run', () => {
    expect(safeNoteId('_templates/daily.md')).toBe('-templates/daily.md');
    expect(safeNoteId('a_b.md')).toBe('a_b.md');
    expect(safeNoteId('plain.md')).toBe('plain.md');
  });
});

describe('withExistingFolders', () => {
  const nfdDir = '폴더'.normalize('NFD');
  it('keeps the spelling a folder already has', () => {
    expect(withExistingFolders('폴더/새노트.md', [`${nfdDir}/안쪽.md`])).toBe(`${nfdDir}/새노트.md`);
    expect(withExistingFolders('폴더/하위/새노트.md', [`${nfdDir}/안쪽.md`])).toBe(`${nfdDir}/하위/새노트.md`);
  });
  it('takes the longest matching folder', () => {
    const sub = '하위'.normalize('NFD');
    expect(withExistingFolders('폴더/하위/x.md', [`${nfdDir}/a.md`, `${nfdDir}/${sub}/b.md`])).toBe(`${nfdDir}/${sub}/x.md`);
  });
  it('leaves ids alone when there is no such folder, or no folder at all', () => {
    expect(withExistingFolders('다른/x.md', [`${nfdDir}/a.md`])).toBe('다른/x.md');
    expect(withExistingFolders('x.md', [`${nfdDir}/a.md`])).toBe('x.md');
    expect(withExistingFolders('폴더2/x.md', [`${nfdDir}/a.md`])).toBe('폴더2/x.md');
  });
});
