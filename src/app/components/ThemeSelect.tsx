// Replaced old dropdown-based theme selector with an icon toggle switch.
'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved as Theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export default function ThemeSelect() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const isDark = theme === 'dark';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
      <span style={{ fontSize: 12, color: 'var(--faint-text)' }}>Theme</span>
      <button
        onClick={toggle}
        role="switch"
        aria-checked={isDark}
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          border: '1px solid var(--surface-border)',
          background: 'var(--surface)',
          color: 'var(--foreground)',
          borderRadius: 999,
          padding: '6px 10px',
          lineHeight: 1,
          cursor: 'pointer',
          transition: 'background .15s, color .15s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}
      >
        {isDark ? <Moon size={16} aria-hidden /> : <Sun size={16} aria-hidden />}
        <span style={{ fontSize: 12 }}>{isDark ? 'Dark' : 'Light'}</span>
      </button>
    </div>
  );
}
