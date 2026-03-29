import { signal } from '@preact/signals';

export type Theme = 'dark' | 'light';

const stored = localStorage.getItem('lokl-theme') as Theme | null;
export const theme = signal<Theme>(stored || 'dark');

export function toggleTheme() {
  const next = theme.value === 'dark' ? 'light' : 'dark';
  theme.value = next;
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('lokl-theme', next);
}
