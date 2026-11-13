// Note ids are paths ("journal/day.md"). Two things can make a typed or
// imported name unusable as one:
//  - PouchDB rejects any id that begins with "_" (reserved for _design, _local…).
//  - "/lead", "trail/", "x/../y" used to become ids verbatim ("/lead.md", "trail/.md").

/** A leading "_" cannot be stored. It is swapped for "-" — a visible, stable rule the UI reports. */
export function safeNoteId(path: string): string {
  return path.replace(/^_+/, (m) => '-'.repeat(m.length));
}

/**
 * Turn what a person typed into a note id: trimmed segments, no empty / "." / ".."
 * segments, ".md" appended, leading "_" swapped per safeNoteId.
 * Returns null when nothing usable is left.
 */
export function normalizeNotePath(input: string): string | null {
  const parts: string[] = [];
  for (const raw of input.replace(/\\/g, '/').split('/')) {
    const seg = raw.trim();
    if (!seg || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  if (parts.length === 0) return null;
  let last = parts[parts.length - 1];
  if (last === '.md') return null;
  if (!last.endsWith('.md')) last += '.md';
  parts[parts.length - 1] = last;
  return safeNoteId(parts.join('/'));
}
