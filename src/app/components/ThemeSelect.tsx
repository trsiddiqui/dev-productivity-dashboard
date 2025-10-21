'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  // Put the theme on <html data-theme="..."> so your CSS vars take effect
  document.documentElement.setAttribute('data-theme', theme);
}

export default function ThemeSelect() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  // Apply on mount (in case the initial render happens before we set it),
  // and whenever the user changes it.
  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
      <span style={{ fontSize: 12, color: 'var(--faint-text)' }}>Theme</span>
      <div className="select-wrapper">
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          className="select-reset"
          style={{
            borderColor: 'var(--surface-border)',
            background: 'var(--surface)',
            color: 'var(--foreground)',
          }}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>
    </label>
  );
}
