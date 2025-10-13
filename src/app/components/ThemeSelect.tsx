'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') return saved as Theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function ThemeSelect() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const b = document.body;
    b.classList.remove('theme-light', 'theme-dark');
    b.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark');
    window.localStorage.setItem('theme', theme);
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
