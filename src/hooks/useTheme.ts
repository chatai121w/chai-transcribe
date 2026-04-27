import { useState, useEffect, useCallback } from 'react';

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  sidebarBackground: string;
  sidebarForeground: string;
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  iconColor: string;
}

/** Non-color visual style options. All optional for backward-compat. */
export interface ThemeStyleOptions {
  /** Border radius in px (applied as --radius). 0 = sharp, 16 = very rounded. */
  radius?: number;
  /** UI density. compact = -2px padding, comfortable = default, spacious = +4px. */
  density?: 'compact' | 'comfortable' | 'spacious';
  /** App-wide font family (CSS font-family value). */
  fontFamily?: string;
  /** Default text color (CSS value, optional override). */
  textColor?: string;
  /** Shadow intensity. */
  shadow?: 'none' | 'soft' | 'medium' | 'strong';
  /** Base font size in px. */
  fontSize?: number;
  /** Default font weight (300–800). */
  fontWeight?: number;
}

export interface AppTheme {
  id: string;
  name: string;
  nameHe: string;
  colors: ThemeColors;
  style?: ThemeStyleOptions;
  isCustom?: boolean;
}

// Built-in themes
export const BUILT_IN_THEMES: AppTheme[] = [
  {
    id: 'default',
    name: 'Default',
    nameHe: 'ברירת מחדל',
    colors: {
      background: '40 15% 96%',
      foreground: '220 60% 8%',
      card: '38 25% 98%',
      cardForeground: '220 60% 8%',
      popover: '38 25% 98%',
      popoverForeground: '220 60% 8%',
      primary: '220 85% 22%',
      primaryForeground: '40 20% 98%',
      secondary: '38 20% 90%',
      secondaryForeground: '220 60% 8%',
      muted: '38 15% 92%',
      mutedForeground: '220 30% 40%',
      accent: '220 75% 35%',
      accentForeground: '40 20% 98%',
      destructive: '0 70% 50%',
      destructiveForeground: '40 20% 98%',
      border: '38 20% 88%',
      input: '38 20% 88%',
      ring: '220 85% 22%',
      sidebarBackground: '38 25% 98%',
      sidebarForeground: '220 60% 8%',
      sidebarPrimary: '220 85% 22%',
      sidebarPrimaryForeground: '40 20% 98%',
      sidebarAccent: '38 20% 94%',
      sidebarAccentForeground: '220 60% 8%',
      sidebarBorder: '38 20% 88%',
      sidebarRing: '220 85% 22%',
      iconColor: '',
    },
  },
  {
    id: 'royal-gold',
    name: 'Royal Gold',
    nameHe: 'זהב מלכותי',
    colors: {
      background: '0 0% 100%',
      foreground: '220 60% 20%',
      card: '0 0% 100%',
      cardForeground: '220 60% 20%',
      popover: '0 0% 100%',
      popoverForeground: '220 60% 20%',
      primary: '43 74% 49%',
      primaryForeground: '0 0% 100%',
      secondary: '43 30% 93%',
      secondaryForeground: '220 60% 20%',
      muted: '43 20% 95%',
      mutedForeground: '220 30% 40%',
      accent: '43 74% 49%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '43 50% 70%',
      input: '43 30% 85%',
      ring: '43 74% 49%',
      sidebarBackground: '0 0% 100%',
      sidebarForeground: '220 60% 20%',
      sidebarPrimary: '43 74% 49%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '43 30% 95%',
      sidebarAccentForeground: '220 60% 20%',
      sidebarBorder: '43 50% 70%',
      sidebarRing: '43 74% 49%',
      iconColor: 'hsl(43, 74%, 49%)',
    },
  },
  {
    id: 'dark-modern',
    name: 'Dark Modern',
    nameHe: 'כהה מודרני',
    colors: {
      background: '220 50% 6%',
      foreground: '40 20% 95%',
      card: '220 45% 9%',
      cardForeground: '40 20% 95%',
      popover: '220 45% 9%',
      popoverForeground: '40 20% 95%',
      primary: '220 80% 55%',
      primaryForeground: '0 0% 100%',
      secondary: '220 40% 15%',
      secondaryForeground: '40 20% 95%',
      muted: '220 35% 12%',
      mutedForeground: '220 20% 65%',
      accent: '220 70% 45%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '220 35% 20%',
      input: '220 35% 20%',
      ring: '220 80% 55%',
      sidebarBackground: '220 50% 6%',
      sidebarForeground: '40 20% 95%',
      sidebarPrimary: '220 80% 55%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '220 40% 12%',
      sidebarAccentForeground: '40 20% 95%',
      sidebarBorder: '220 35% 20%',
      sidebarRing: '220 80% 55%',
      iconColor: '',
    },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    nameHe: 'אמרלד ירוק',
    colors: {
      background: '150 20% 96%',
      foreground: '150 50% 8%',
      card: '150 25% 98%',
      cardForeground: '150 50% 8%',
      popover: '150 25% 98%',
      popoverForeground: '150 50% 8%',
      primary: '152 70% 30%',
      primaryForeground: '0 0% 100%',
      secondary: '150 20% 90%',
      secondaryForeground: '150 50% 8%',
      muted: '150 15% 92%',
      mutedForeground: '150 20% 40%',
      accent: '152 65% 35%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '150 20% 85%',
      input: '150 20% 85%',
      ring: '152 70% 30%',
      sidebarBackground: '150 25% 98%',
      sidebarForeground: '150 50% 8%',
      sidebarPrimary: '152 70% 30%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '150 20% 94%',
      sidebarAccentForeground: '150 50% 8%',
      sidebarBorder: '150 20% 85%',
      sidebarRing: '152 70% 30%',
      iconColor: '',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    nameHe: 'שקיעה',
    colors: {
      background: '20 30% 97%',
      foreground: '20 60% 10%',
      card: '20 35% 99%',
      cardForeground: '20 60% 10%',
      popover: '20 35% 99%',
      popoverForeground: '20 60% 10%',
      primary: '15 80% 50%',
      primaryForeground: '0 0% 100%',
      secondary: '20 25% 90%',
      secondaryForeground: '20 60% 10%',
      muted: '20 15% 93%',
      mutedForeground: '20 25% 40%',
      accent: '340 70% 50%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '20 25% 85%',
      input: '20 25% 85%',
      ring: '15 80% 50%',
      sidebarBackground: '20 35% 99%',
      sidebarForeground: '20 60% 10%',
      sidebarPrimary: '15 80% 50%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '20 25% 94%',
      sidebarAccentForeground: '20 60% 10%',
      sidebarBorder: '20 25% 85%',
      sidebarRing: '15 80% 50%',
      iconColor: '',
    },
  },
  {
    id: 'purple-night',
    name: 'Purple Night',
    nameHe: 'לילה סגול',
    colors: {
      background: '270 40% 8%',
      foreground: '270 10% 92%',
      card: '270 35% 12%',
      cardForeground: '270 10% 92%',
      popover: '270 35% 12%',
      popoverForeground: '270 10% 92%',
      primary: '270 70% 55%',
      primaryForeground: '0 0% 100%',
      secondary: '270 30% 18%',
      secondaryForeground: '270 10% 92%',
      muted: '270 25% 15%',
      mutedForeground: '270 15% 60%',
      accent: '280 65% 60%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 50%',
      destructiveForeground: '0 0% 100%',
      border: '270 25% 22%',
      input: '270 25% 22%',
      ring: '270 70% 55%',
      sidebarBackground: '270 40% 8%',
      sidebarForeground: '270 10% 92%',
      sidebarPrimary: '270 70% 55%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '270 30% 15%',
      sidebarAccentForeground: '270 10% 92%',
      sidebarBorder: '270 25% 22%',
      sidebarRing: '270 70% 55%',
      iconColor: '',
    },
  },
  {
    id: 'haredi-classic',
    name: 'Haredi Classic',
    nameHe: 'חרדי קלאסי',
    colors: {
      background: '40 25% 97%',
      foreground: '0 0% 8%',
      card: '40 30% 99%',
      cardForeground: '0 0% 8%',
      popover: '40 30% 99%',
      popoverForeground: '0 0% 8%',
      primary: '0 0% 12%',
      primaryForeground: '40 25% 98%',
      secondary: '40 20% 92%',
      secondaryForeground: '0 0% 8%',
      muted: '40 18% 94%',
      mutedForeground: '0 0% 35%',
      accent: '15 60% 35%',
      accentForeground: '40 25% 98%',
      destructive: '0 70% 45%',
      destructiveForeground: '40 25% 98%',
      border: '40 25% 82%',
      input: '40 22% 88%',
      ring: '0 0% 12%',
      sidebarBackground: '40 30% 99%',
      sidebarForeground: '0 0% 8%',
      sidebarPrimary: '0 0% 12%',
      sidebarPrimaryForeground: '40 25% 98%',
      sidebarAccent: '40 20% 94%',
      sidebarAccentForeground: '0 0% 8%',
      sidebarBorder: '40 25% 82%',
      sidebarRing: '0 0% 12%',
      iconColor: '',
    },
    style: {
      radius: 4,
      density: 'comfortable',
      fontFamily: "'Frank Ruhl Libre', serif",
      fontSize: 16,
      fontWeight: 400,
      shadow: 'none',
    },
  },
  {
    id: 'modern-tech',
    name: 'Modern Tech',
    nameHe: 'הייטק מודרני',
    colors: {
      background: '210 30% 98%',
      foreground: '210 50% 12%',
      card: '0 0% 100%',
      cardForeground: '210 50% 12%',
      popover: '0 0% 100%',
      popoverForeground: '210 50% 12%',
      primary: '195 95% 45%',
      primaryForeground: '0 0% 100%',
      secondary: '210 25% 93%',
      secondaryForeground: '210 50% 12%',
      muted: '210 20% 95%',
      mutedForeground: '210 15% 45%',
      accent: '270 80% 60%',
      accentForeground: '0 0% 100%',
      destructive: '0 75% 55%',
      destructiveForeground: '0 0% 100%',
      border: '210 25% 88%',
      input: '210 25% 88%',
      ring: '195 95% 45%',
      sidebarBackground: '210 30% 98%',
      sidebarForeground: '210 50% 12%',
      sidebarPrimary: '195 95% 45%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '210 25% 95%',
      sidebarAccentForeground: '210 50% 12%',
      sidebarBorder: '210 25% 88%',
      sidebarRing: '195 95% 45%',
      iconColor: '',
    },
    style: {
      radius: 12,
      density: 'comfortable',
      fontFamily: "'Heebo', sans-serif",
      fontSize: 14,
      fontWeight: 400,
      shadow: 'medium',
    },
  },
  {
    id: 'soft-pastel',
    name: 'Soft Pastel',
    nameHe: 'פסטל רך',
    colors: {
      background: '340 30% 98%',
      foreground: '340 40% 18%',
      card: '0 0% 100%',
      cardForeground: '340 40% 18%',
      popover: '0 0% 100%',
      popoverForeground: '340 40% 18%',
      primary: '340 60% 55%',
      primaryForeground: '0 0% 100%',
      secondary: '340 25% 93%',
      secondaryForeground: '340 40% 18%',
      muted: '340 20% 95%',
      mutedForeground: '340 15% 45%',
      accent: '180 50% 55%',
      accentForeground: '0 0% 100%',
      destructive: '0 70% 60%',
      destructiveForeground: '0 0% 100%',
      border: '340 25% 88%',
      input: '340 25% 88%',
      ring: '340 60% 55%',
      sidebarBackground: '340 30% 98%',
      sidebarForeground: '340 40% 18%',
      sidebarPrimary: '340 60% 55%',
      sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '340 25% 95%',
      sidebarAccentForeground: '340 40% 18%',
      sidebarBorder: '340 25% 88%',
      sidebarRing: '340 60% 55%',
      iconColor: '',
    },
    style: {
      radius: 16,
      density: 'spacious',
      fontFamily: "'Rubik', sans-serif",
      fontSize: 15,
      fontWeight: 400,
      shadow: 'soft',
    },
  },
  {
    id: 'earth-warm',
    name: 'Earth Warm',
    nameHe: 'אדמה חמה',
    colors: {
      background: '30 25% 95%',
      foreground: '25 50% 15%',
      card: '30 30% 98%',
      cardForeground: '25 50% 15%',
      popover: '30 30% 98%',
      popoverForeground: '25 50% 15%',
      primary: '25 70% 35%',
      primaryForeground: '30 30% 98%',
      secondary: '30 20% 88%',
      secondaryForeground: '25 50% 15%',
      muted: '30 15% 91%',
      mutedForeground: '25 25% 35%',
      accent: '15 65% 50%',
      accentForeground: '30 30% 98%',
      destructive: '0 70% 45%',
      destructiveForeground: '30 30% 98%',
      border: '30 22% 82%',
      input: '30 22% 85%',
      ring: '25 70% 35%',
      sidebarBackground: '30 30% 98%',
      sidebarForeground: '25 50% 15%',
      sidebarPrimary: '25 70% 35%',
      sidebarPrimaryForeground: '30 30% 98%',
      sidebarAccent: '30 20% 92%',
      sidebarAccentForeground: '25 50% 15%',
      sidebarBorder: '30 22% 82%',
      sidebarRing: '25 70% 35%',
      iconColor: '',
    },
    style: {
      radius: 6,
      density: 'comfortable',
      fontFamily: "'Noto Sans Hebrew', sans-serif",
      fontSize: 14,
      fontWeight: 500,
      shadow: 'soft',
    },
  },
];

const CSS_VAR_MAP: Record<keyof ThemeColors, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  destructiveForeground: '--destructive-foreground',
  border: '--border',
  input: '--input',
  ring: '--ring',
  sidebarBackground: '--sidebar-background',
  sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
  sidebarRing: '--sidebar-ring',
  iconColor: '--icon-color',
};

function applyThemeToDOM(colors: ThemeColors, style?: ThemeStyleOptions) {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(CSS_VAR_MAP)) {
    const value = colors[key as keyof ThemeColors];
    if (cssVar === '--icon-color') {
      root.style.setProperty(cssVar, value || 'inherit');
    } else {
      root.style.setProperty(cssVar, value);
    }
  }

  // ── Apply style options ──
  const s = style || {};
  if (typeof s.radius === 'number') {
    root.style.setProperty('--radius', `${s.radius}px`);
  } else {
    root.style.removeProperty('--radius');
  }
  // Density → base padding scale
  const density = s.density || 'comfortable';
  const densityScale = density === 'compact' ? '0.85' : density === 'spacious' ? '1.15' : '1';
  root.style.setProperty('--density-scale', densityScale);
  root.dataset.density = density;

  if (s.fontFamily) root.style.setProperty('--app-font-family', s.fontFamily);
  else root.style.removeProperty('--app-font-family');
  if (typeof s.fontSize === 'number') root.style.setProperty('--app-font-size', `${s.fontSize}px`);
  else root.style.removeProperty('--app-font-size');
  if (typeof s.fontWeight === 'number') root.style.setProperty('--app-font-weight', String(s.fontWeight));
  else root.style.removeProperty('--app-font-weight');
  if (s.textColor) root.style.setProperty('--app-text-color', s.textColor);
  else root.style.removeProperty('--app-text-color');

  const shadowMap: Record<string, string> = {
    none: 'none',
    soft: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
    medium: '0 4px 6px -1px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.10)',
    strong: '0 20px 25px -5px rgb(0 0 0 / 0.18), 0 8px 10px -6px rgb(0 0 0 / 0.18)',
  };
  root.style.setProperty('--app-shadow', shadowMap[s.shadow || 'soft']);
}

export function useTheme() {
  const [activeThemeId, setActiveThemeId] = useState<string>('default');
  const [customThemes, setCustomThemes] = useState<AppTheme[]>([]);

  // Load on mount
  useEffect(() => {
    const applyFromStorage = () => {
      const savedId = localStorage.getItem('app_theme_id') || 'default';
      const savedCustom = localStorage.getItem('app_custom_themes');
      const customs: AppTheme[] = savedCustom ? JSON.parse(savedCustom) : [];
      setCustomThemes(customs);
      setActiveThemeId(savedId);
      const all = [...BUILT_IN_THEMES, ...customs];
      const theme = all.find(t => t.id === savedId) || BUILT_IN_THEMES[0];
      applyThemeToDOM(theme.colors, theme.style);
    };
    applyFromStorage();
    // Re-apply when cloud preferences load (may have different theme)
    window.addEventListener('cloud-prefs-loaded', applyFromStorage);
    return () => window.removeEventListener('cloud-prefs-loaded', applyFromStorage);
  }, []);

  const allThemes = [...BUILT_IN_THEMES, ...customThemes];

  const setTheme = useCallback((themeId: string) => {
    const all = [...BUILT_IN_THEMES, ...customThemes];
    const theme = all.find(t => t.id === themeId);
    if (!theme) return;
    setActiveThemeId(themeId);
    localStorage.setItem('app_theme_id', themeId);
    localStorage.setItem('app_theme_updated_at', String(Date.now()));
    applyThemeToDOM(theme.colors, theme.style);
  }, [customThemes]);

  const saveCustomTheme = useCallback((theme: AppTheme) => {
    setCustomThemes(prev => {
      const existing = prev.findIndex(t => t.id === theme.id);
      const updated = existing >= 0
        ? prev.map(t => t.id === theme.id ? { ...theme, isCustom: true } : t)
        : [...prev, { ...theme, isCustom: true }];
      localStorage.setItem('app_custom_themes', JSON.stringify(updated));
      localStorage.setItem('app_theme_updated_at', String(Date.now()));
      return updated;
    });
  }, []);

  const deleteCustomTheme = useCallback((themeId: string) => {
    setCustomThemes(prev => {
      const updated = prev.filter(t => t.id !== themeId);
      localStorage.setItem('app_custom_themes', JSON.stringify(updated));
      localStorage.setItem('app_theme_updated_at', String(Date.now()));
      return updated;
    });
    if (activeThemeId === themeId) {
      setTheme('default');
    }
  }, [activeThemeId, setTheme]);

  return {
    activeThemeId,
    allThemes,
    customThemes,
    setTheme,
    saveCustomTheme,
    deleteCustomTheme,
  };
}
