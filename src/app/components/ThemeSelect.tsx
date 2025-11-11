// Replaced old dropdown-based theme selector with an icon toggle switch.
'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon, Cloud } from 'lucide-react';

type Theme = 'light' | 'dark' | 'grey';
const STORAGE_KEY = 'theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark' || saved === 'grey') return saved as Theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export default function ThemeSelect() {
  // Start with a deterministic value to avoid SSR/client mismatches.
  const [theme, setTheme] = useState<Theme>('light');

  // On mount, detect the real theme (localStorage / media) and then update.
  useEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
  }, []);

  // Apply theme and persist whenever it changes on the client.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((t) => (t === 'light' ? 'grey' : t === 'grey' ? 'dark' : 'light'));
  const icon = theme === 'dark' ? <Moon size={16} aria-hidden /> : theme === 'grey' ? <Cloud size={16} aria-hidden /> : <Sun size={16} aria-hidden />;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
      <span style={{ fontSize: 12, color: 'var(--faint-text)' }}>Theme</span>
      <button
        onClick={toggle}
        aria-label={`Switch theme (current: ${theme})`}
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
        {icon}
        <span style={{ fontSize: 12 }}>{theme.charAt(0).toUpperCase() + theme.slice(1)}</span>
      </button>
    </div>
  );
}
