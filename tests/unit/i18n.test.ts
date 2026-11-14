import { describe, it, expect } from 'vitest';
import { en } from '../../src/i18n/en';
import ko from '../../src/i18n/ko';
import ja from '../../src/i18n/ja';
import zh from '../../src/i18n/zh';
import es from '../../src/i18n/es';
import fr from '../../src/i18n/fr';
import de from '../../src/i18n/de';
import pt from '../../src/i18n/pt';
import { tf } from '../../src/i18n';

type Tree = { [k: string]: string | Tree };
function flat(t: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === 'string') out[prefix + k] = v; else Object.assign(out, flat(v, `${prefix}${k}.`));
  }
  return out;
}
const slots = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();

describe('locales', () => {
  const base = flat(en as unknown as Tree);
  const all = { ko, ja, zh, es, fr, de, pt } as unknown as Record<string, Tree>;

  it('every message keeps the same {slots} as English', () => {
    for (const [lang, tree] of Object.entries(all)) {
      const f = flat(tree);
      for (const [key, text] of Object.entries(base)) expect(slots(f[key]), `${lang}.${key}`).toBe(slots(text));
    }
  });

  // These sections were English in five locales (the data panel, conflicts, the trash, and every toast).
  it('the data, conflict, trash and message sections are translated', () => {
    const same = ['msg.syncError', 'msg.offline']; // "Error" (es), "Offline" (de, pt) are the same word
    for (const [lang, tree] of Object.entries(all)) {
      const f = flat(tree);
      const untranslated = Object.keys(base).filter(k => /^(msg|conflicts|trash|settings\.data)\./.test(k) && !same.includes(k) && f[k] === base[k]);
      expect(untranslated, lang).toEqual([]);
    }
  });

  it('tf fills slots and leaves unknown ones', () => {
    expect(tf('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
  });
});
