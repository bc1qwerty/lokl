import { describe, expect, it } from 'vitest';
import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';
import { codeLanguageFor } from '../../src/lib/code-languages';

const lang = new LanguageSupport(StreamLanguage.define({ token(s) { s.skipToEnd(); return 'keyword'; } }));

describe('codeLanguageFor', () => {
  it('언어 묶음 import 가 실패해도 거절하지 않고, 원래 설명은 다시 받을 수 있게 남긴다', async () => {
    let calls = 0;
    const failing = LanguageDescription.of({ name: 'Python', alias: ['py'], load: async () => { calls += 1; throw new TypeError('Failed to fetch dynamically imported module'); } });
    const find = codeLanguageFor([failing]);
    const wrapped = find('python');
    expect(wrapped).not.toBeNull();
    await expect(wrapped!.load()).resolves.toBeInstanceOf(LanguageSupport);
    expect(failing.support).toBeUndefined();
    await expect(find('py')!.load()).resolves.toBeInstanceOf(LanguageSupport);
    expect(calls).toBe(2); // 실패 뒤 다시 시도한다
  });

  it('이미 받은 언어는 그대로, 모르는 언어는 null', async () => {
    const ok = LanguageDescription.of({ name: 'Rust', load: async () => lang });
    await ok.load();
    const find = codeLanguageFor([ok]);
    expect(find('rust')).toBe(ok);
    expect(find('nope')).toBeNull();
  });
});
