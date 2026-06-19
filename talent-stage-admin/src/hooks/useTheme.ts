import { useCallback, useEffect, useState } from 'react';

type ThemeMode = 'dark' | 'light';

const THEME_STORAGE_KEY = 'talents-admin-theme';

function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'dark';

  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') return stored;

  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'light' : 'dark';
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', mode);
}

const initialTheme = resolveInitialTheme();

export function initTheme() {
  applyTheme(resolveInitialTheme());
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  return {
    theme,
    isDarkTheme: theme === 'dark',
    toggleTheme,
  };
}
