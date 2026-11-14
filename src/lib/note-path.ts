// Note ids are paths ("journal/day.md"). Two things can make a typed or
// imported name unusable as one:
//  - PouchDB rejects any id that begins with "_" (reserved for _design, _local…).
//  - "/lead", "trail/", "x/../y" used to become ids verbatim ("/lead.md", "trail/.md").

/** A leading "_" cannot be stored. It is swapped for "-" — a visible, stable rule the UI reports. */
export function safeNoteId(path: string): string {
  return path.replace(/^_+/, (m) => '-'.repeat(m.length));
}

/**
 * One spelling for comparisons. A file name from a Mac folder arrives decomposed (NFD: "한" as three
 * jamo), what the keyboard types is composed (NFC) — the two look the same and never compared equal,
 * so [[links]], quick open and a second "same" note all missed. New ids are stored NFC; ids already
 * stored NFD are left as they are and matched through this.
 */
export function nfc(text: string): string {
  return text.normalize('NFC');
}

/**
 * Turn what a person typed into a note id: trimmed segments, no empty / "." / ".."
 * segments, ".md" appended, leading "_" swapped per safeNoteId.
 * Returns null when nothing usable is left.
 */
export function normalizeNotePath(input: string): string | null {
  const parts: string[] = [];
  for (const raw of nfc(input).replace(/\\/g, '/').split('/')) {
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

/**
 * Spell the folders of a new id the way the vault already spells them. A folder that came from a
 * Mac is stored NFD; a note typed into it (rename, "new file here") is NFC, and with the folder
 * part NFC too the same folder showed up twice in the tree.
 */
export function withExistingFolders(id: string, existing: Iterable<string>): string {
  const cut = id.lastIndexOf('/');
  if (cut < 0) return id;
  const wanted = nfc(id.slice(0, cut));
  let best = '';
  for (const p of existing) {
    // every folder prefix of every existing id; the longest one that matches wins
    for (let at = p.indexOf('/'); at >= 0; at = p.indexOf('/', at + 1)) {
      const dir = p.slice(0, at);
      const n = nfc(dir);
      if (n.length <= nfc(best).length) continue;
      if (wanted === n || wanted.startsWith(n + '/')) best = dir;
    }
  }
  if (!best) return id;
  return best + nfc(id).slice(nfc(best).length);
}

// cyrb53 — a short, stable, non-cryptographic hash; only has to tell texts apart within one note's copies.
export function contentHash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
