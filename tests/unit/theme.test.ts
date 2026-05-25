import { describe, it, expect, beforeEach } from 'vitest';
import { theme, toggleTheme } from '../../src/lib/theme';

beforeEach(() => {
  localStorage.clear();
  // Reset the signal to a known state before each test
  theme.value = 'dark';
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  it('has a default value of dark or light', () => {
    expect(['dark', 'light']).toContain(theme.value);
  });

  it('toggles from dark to light', () => {
    theme.value = 'dark';
    toggleTheme();
    expect(theme.value).toBe('light');
  });

  it('toggles from light to dark', () => {
    theme.value = 'light';
    toggleTheme();
    expect(theme.value).toBe('dark');
  });

  it('persists to localStorage after toggle', () => {
    theme.value = 'dark';
    toggleTheme();
    expect(localStorage.getItem('lokl-theme')).toBe('light');
  });

  it('updates data-theme attribute on document element after toggle', () => {
    theme.value = 'dark';
    toggleTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('localStorage key is lokl-theme', () => {
    theme.value = 'light';
    toggleTheme();
    expect(localStorage.getItem('lokl-theme')).toBe('dark');
  });

  it('module loads without error and theme signal exists', () => {
    expect(theme).toBeDefined();
    expect(theme.value).toBeDefined();
  });
});
