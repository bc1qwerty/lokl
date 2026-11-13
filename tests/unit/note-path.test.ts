import { describe, it, expect } from 'vitest';
import { normalizeNotePath, safeNoteId } from '../../src/lib/note-path';

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

describe('safeNoteId', () => {
  it('touches only a leading underscore run', () => {
    expect(safeNoteId('_templates/daily.md')).toBe('-templates/daily.md');
    expect(safeNoteId('a_b.md')).toBe('a_b.md');
    expect(safeNoteId('plain.md')).toBe('plain.md');
  });
});
