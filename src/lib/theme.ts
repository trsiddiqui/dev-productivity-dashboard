export const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'grey', label: 'Graphite' },
  { id: 'nord', label: 'Nord' },
  { id: 'rose-pine', label: 'Rose Pine' },
  { id: 'catppuccin', label: 'Catppuccin' },
  { id: 'everforest', label: 'Everforest' },
  { id: 'funky', label: 'Funky' },
  { id: 'terminal', label: 'Terminal' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const DEFAULT_THEME: ThemeId = 'light';

export const THEME_IDS = THEMES.map((theme) => theme.id);

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return !!value && THEME_IDS.includes(value as ThemeId);
}
