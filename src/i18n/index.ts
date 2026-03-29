import { signal, computed } from '@preact/signals';
import { en, type Locale } from './en';

const locales: Record<string, Locale> = { en };

export const currentLang = signal(
  localStorage.getItem('lokl-lang') || 'en'
);

export const t = computed(() => locales[currentLang.value] || en);

export async function setLang(lang: string) {
  if (!locales[lang]) {
    try {
      const mod = await import(`./${lang}.ts`);
      locales[lang] = mod.default;
    } catch {
      console.warn(`Locale "${lang}" not found, falling back to English`);
      return;
    }
  }
  currentLang.value = lang;
  localStorage.setItem('lokl-lang', lang);
  document.documentElement.lang = lang;
}
