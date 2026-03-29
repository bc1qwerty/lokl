import { signal, computed } from '@preact/signals';
import { en, type Locale } from './en';

// Pre-load all locales (small files, no need for dynamic import)
import ko from './ko';
import ja from './ja';
import zh from './zh';
import es from './es';
import fr from './fr';
import de from './de';
import pt from './pt';

const locales: Record<string, Locale> = { en, ko, ja, zh, es, fr, de, pt };

export const supportedLangs = ['en', 'ko', 'ja', 'zh', 'es', 'fr', 'de', 'pt'] as const;
export const langLabels: Record<string, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  zh: '中文',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  pt: 'Português',
};

export const currentLang = signal(
  localStorage.getItem('lokl-lang') || 'en'
);

export const t = computed(() => locales[currentLang.value] || en);

export function setLang(lang: string) {
  if (!locales[lang]) return;
  currentLang.value = lang;
  localStorage.setItem('lokl-lang', lang);
  document.documentElement.lang = lang;
}
