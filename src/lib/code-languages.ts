import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';

// 강조 없이 그대로 두는 언어 — 언어 묶음을 못 받았을 때 대신 쓴다.
const plain = new LanguageSupport(StreamLanguage.define({ token(stream) { stream.skipToEnd(); return null; } }));

/**
 * 코드 블록 언어 찾기. 언어 묶음은 처음 쓸 때 받는데, 서비스 워커 없이 오프라인이면 그 import 가 실패해
 * 처리되지 않은 거절(pageerror)이 났다(2026-11-14). 실패하면 이번 한 번만 강조 없이 둔다 — 원래 설명은
 * 실패 뒤 다시 받을 수 있는 상태로 남으므로(LanguageDescription.load 가 실패 시 캐시를 비운다) 다음 재파싱에서 다시 시도한다.
 */
export function codeLanguageFor(list: readonly LanguageDescription[]) {
  return (info: string): LanguageDescription | null => {
    const d = LanguageDescription.matchLanguageName(list, info, true);
    if (!d || d.support) return d;
    return LanguageDescription.of({ name: d.name, load: () => d.load().catch(() => plain) });
  };
}
