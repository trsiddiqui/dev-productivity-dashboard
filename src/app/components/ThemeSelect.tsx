// Compact header theme picker.
'use client';

import { useEffect, useState, type JSX } from 'react';
import { Cloud, Cpu, Flower2, Moon, Palette, Sparkles, Sun, Trees, Waves } from 'lucide-react';
import { DEFAULT_THEME, isThemeId, THEMES, type ThemeId } from '@/lib/theme';

const STORAGE_KEY = 'theme';

function getInitialTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (isThemeId(saved)) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : DEFAULT_THEME;
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute('data-theme', theme);
}

const ICONS: Record<ThemeId, JSX.Element> = {
  light: <Sun size={16} aria-hidden />,
  dark: <Moon size={16} aria-hidden />,
  grey: <Cloud size={16} aria-hidden />,
  nord: <Waves size={16} aria-hidden />,
  'rose-pine': <Flower2 size={16} aria-hidden />,
  catppuccin: <Palette size={16} aria-hidden />,
  everforest: <Trees size={16} aria-hidden />,
  funky: <Sparkles size={16} aria-hidden />,
  terminal: <Cpu size={16} aria-hidden />,
};

export default function ThemeSelect() {
  // Start with a deterministic value to avoid SSR/client mismatches.
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);

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

  const cycleTheme = () => {
    const index = THEMES.findIndex((item) => item.id === theme);
    const next = THEMES[(index + 1) % THEMES.length] ?? THEMES[0];
    setTheme(next.id);
  };

  const activeTheme = THEMES.find((item) => item.id === theme) ?? THEMES[0];
  const icon = ICONS[activeTheme.id];

  return (
    <div className="app-header-theme">
      <span className="app-header-theme__label">Theme</span>
      <button
        type="button"
        onClick={cycleTheme}
        aria-label={`Switch theme (current: ${activeTheme.label})`}
        className="app-header-icon-button app-header-theme__picker"
      >
        {icon}
        <span className="app-header-theme__value">{activeTheme.label}</span>
      </button>
    </div>
  );
}
