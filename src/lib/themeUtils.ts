/**
 * Theme utilities: WCAG contrast checker, AI keyword-based palette generator,
 * import/export helpers for AppTheme objects.
 */
import type { AppTheme, ThemeColors, ThemeStyleOptions } from '@/hooks/useTheme';

// ─── WCAG Contrast Ratio ─────────────────────────────────────
/** Parse "H S% L%" string to {h,s,l} numbers. */
function parseHsl(hsl: string): { h: number; s: number; l: number } | null {
  if (!hsl) return null;
  const clean = hsl.replace(/hsl\(|\)/g, '').trim();
  const parts = clean.split(/\s+/);
  if (parts.length < 3) return null;
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  if (isNaN(h) || isNaN(s) || isNaN(l)) return null;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [f(0), f(8), f(4)];
}

function relativeLuminance(r: number, g: number, b: number): number {
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio between two HSL strings. Returns 1..21. */
export function contrastRatio(hsl1: string, hsl2: string): number {
  const a = parseHsl(hsl1);
  const b = parseHsl(hsl2);
  if (!a || !b) return 1;
  const [r1, g1, b1] = hslToRgb(a.h, a.s, a.l);
  const [r2, g2, b2] = hslToRgb(b.h, b.s, b.l);
  const l1 = relativeLuminance(r1, g1, b1);
  const l2 = relativeLuminance(r2, g2, b2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export type ContrastLevel = 'fail' | 'aa-large' | 'aa' | 'aaa';

export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= 7) return 'aaa';
  if (ratio >= 4.5) return 'aa';
  if (ratio >= 3) return 'aa-large';
  return 'fail';
}

export function contrastLabel(level: ContrastLevel): string {
  switch (level) {
    case 'aaa': return 'מצוין (AAA)';
    case 'aa': return 'תקין (AA)';
    case 'aa-large': return 'טקסט גדול בלבד';
    case 'fail': return '⚠️ ניגוד נמוך';
  }
}

// ─── Import / Export ──────────────────────────────────────────
export function exportThemeToJson(theme: AppTheme): string {
  const { isCustom: _isCustom, ...rest } = theme;
  void _isCustom;
  return JSON.stringify({ __type: 'smart-hebrew-transcriber-theme', version: 1, theme: rest }, null, 2);
}

export function importThemeFromJson(json: string): AppTheme | null {
  try {
    const parsed = JSON.parse(json);
    const t = parsed.theme || parsed;
    if (!t || typeof t !== 'object' || !t.colors) return null;
    return {
      id: `custom-${Date.now()}`,
      name: t.name || t.nameHe || 'Imported',
      nameHe: t.nameHe || t.name || 'מיובא',
      colors: t.colors as ThemeColors,
      style: t.style as ThemeStyleOptions | undefined,
      isCustom: true,
    };
  } catch {
    return null;
  }
}

export function downloadFile(filename: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── AI keyword-based palette generator ───────────────────────
interface PaletteSeed {
  bgHue: number; bgSat: number; bgLight: number;
  fgHue: number; fgSat: number; fgLight: number;
  primaryHue: number; primarySat: number; primaryLight: number;
  accentHue: number; accentSat: number; accentLight: number;
  isDark: boolean;
  style: ThemeStyleOptions;
}

const KEYWORD_SEEDS: { keywords: string[]; seed: PaletteSeed }[] = [
  {
    keywords: ['כהה', 'לילה', 'שחור', 'dark', 'night', 'black'],
    seed: { bgHue: 220, bgSat: 30, bgLight: 8, fgHue: 40, fgSat: 15, fgLight: 92,
      primaryHue: 220, primarySat: 75, primaryLight: 50, accentHue: 280, accentSat: 70, accentLight: 55,
      isDark: true, style: { radius: 10, shadow: 'medium', fontFamily: "'Heebo', sans-serif" } },
  },
  {
    keywords: ['חם', 'אדום', 'כתום', 'אש', 'warm', 'red', 'orange', 'fire'],
    seed: { bgHue: 25, bgSat: 25, bgLight: 96, fgHue: 20, fgSat: 50, fgLight: 12,
      primaryHue: 15, primarySat: 75, primaryLight: 45, accentHue: 35, accentSat: 80, accentLight: 50,
      isDark: false, style: { radius: 8, shadow: 'soft' } },
  },
  {
    keywords: ['קר', 'כחול', 'ים', 'תכלת', 'cool', 'blue', 'sea', 'ocean'],
    seed: { bgHue: 210, bgSat: 30, bgLight: 97, fgHue: 215, fgSat: 50, fgLight: 12,
      primaryHue: 200, primarySat: 80, primaryLight: 40, accentHue: 195, accentSat: 70, accentLight: 50,
      isDark: false, style: { radius: 10, shadow: 'soft' } },
  },
  {
    keywords: ['ירוק', 'טבע', 'יער', 'green', 'nature', 'forest'],
    seed: { bgHue: 145, bgSat: 20, bgLight: 96, fgHue: 150, fgSat: 50, fgLight: 10,
      primaryHue: 152, primarySat: 65, primaryLight: 32, accentHue: 95, accentSat: 55, accentLight: 45,
      isDark: false, style: { radius: 8, shadow: 'soft' } },
  },
  {
    keywords: ['סגול', 'מלכותי', 'יוקרתי', 'purple', 'royal', 'luxury', 'violet'],
    seed: { bgHue: 270, bgSat: 25, bgLight: 96, fgHue: 270, fgSat: 50, fgLight: 12,
      primaryHue: 270, primarySat: 70, primaryLight: 45, accentHue: 320, accentSat: 65, accentLight: 50,
      isDark: false, style: { radius: 12, shadow: 'medium' } },
  },
  {
    keywords: ['זהב', 'gold', 'יהלום', 'יוקרה'],
    seed: { bgHue: 0, bgSat: 0, bgLight: 99, fgHue: 220, fgSat: 50, fgLight: 18,
      primaryHue: 43, primarySat: 75, primaryLight: 48, accentHue: 38, accentSat: 80, accentLight: 55,
      isDark: false, style: { radius: 6, shadow: 'medium', fontFamily: "'Frank Ruhl Libre', serif" } },
  },
  {
    keywords: ['תורני', 'מסורת', 'חרדי', 'דתי', 'יהודי'],
    seed: { bgHue: 40, bgSat: 25, bgLight: 97, fgHue: 0, fgSat: 0, fgLight: 8,
      primaryHue: 0, primarySat: 0, primaryLight: 12, accentHue: 15, accentSat: 60, accentLight: 35,
      isDark: false, style: { radius: 4, shadow: 'none', fontFamily: "'David Libre', serif", fontSize: 16 } },
  },
  {
    keywords: ['מינימליסט', 'נקי', 'פשוט', 'minimal', 'clean'],
    seed: { bgHue: 0, bgSat: 0, bgLight: 100, fgHue: 0, fgSat: 0, fgLight: 10,
      primaryHue: 0, primarySat: 0, primaryLight: 15, accentHue: 220, accentSat: 60, accentLight: 50,
      isDark: false, style: { radius: 4, shadow: 'none', fontFamily: "'Heebo', sans-serif" } },
  },
];

const DEFAULT_SEED: PaletteSeed = {
  bgHue: 40, bgSat: 15, bgLight: 96, fgHue: 220, fgSat: 60, fgLight: 8,
  primaryHue: 220, primarySat: 75, primaryLight: 35, accentHue: 195, accentSat: 70, accentLight: 45,
  isDark: false, style: { radius: 8, shadow: 'soft' },
};

function pickSeed(description: string): PaletteSeed {
  const lower = description.toLowerCase();
  for (const entry of KEYWORD_SEEDS) {
    if (entry.keywords.some(k => lower.includes(k.toLowerCase()))) return entry.seed;
  }
  return DEFAULT_SEED;
}

/** Generate a complete AppTheme from a free-text Hebrew/English description. */
export function generateThemeFromDescription(description: string, name?: string): AppTheme {
  const seed = pickSeed(description);
  const isDark = seed.isDark;
  const fg = `${seed.fgHue} ${seed.fgSat}% ${seed.fgLight}%`;
  const bg = `${seed.bgHue} ${seed.bgSat}% ${seed.bgLight}%`;
  const card = isDark
    ? `${seed.bgHue} ${seed.bgSat}% ${Math.min(95, seed.bgLight + 3)}%`
    : `${seed.bgHue} ${Math.min(40, seed.bgSat + 5)}% ${Math.min(100, seed.bgLight + 2)}%`;
  const muted = `${seed.bgHue} ${Math.max(8, seed.bgSat - 5)}% ${isDark ? seed.bgLight + 5 : seed.bgLight - 4}%`;
  const mutedFg = `${seed.fgHue} ${Math.max(15, seed.fgSat - 30)}% ${isDark ? seed.fgLight - 30 : seed.fgLight + 30}%`;
  const border = `${seed.bgHue} ${Math.max(15, seed.bgSat)}% ${isDark ? seed.bgLight + 12 : seed.bgLight - 10}%`;
  const primary = `${seed.primaryHue} ${seed.primarySat}% ${seed.primaryLight}%`;
  const primaryFg = isDark || seed.primaryLight < 50 ? '0 0% 100%' : `${seed.fgHue} ${seed.fgSat}% ${seed.fgLight}%`;
  const accent = `${seed.accentHue} ${seed.accentSat}% ${seed.accentLight}%`;
  const accentFg = seed.accentLight < 60 ? '0 0% 100%' : `${seed.fgHue} ${seed.fgSat}% ${seed.fgLight}%`;
  const secondary = isDark
    ? `${seed.bgHue} ${seed.bgSat}% ${seed.bgLight + 8}%`
    : `${seed.bgHue} ${Math.max(15, seed.bgSat)}% ${seed.bgLight - 6}%`;

  const colors: ThemeColors = {
    background: bg,
    foreground: fg,
    card,
    cardForeground: fg,
    popover: card,
    popoverForeground: fg,
    primary,
    primaryForeground: primaryFg,
    secondary,
    secondaryForeground: fg,
    muted,
    mutedForeground: mutedFg,
    accent,
    accentForeground: accentFg,
    destructive: '0 70% 50%',
    destructiveForeground: '0 0% 100%',
    border,
    input: border,
    ring: primary,
    sidebarBackground: card,
    sidebarForeground: fg,
    sidebarPrimary: primary,
    sidebarPrimaryForeground: primaryFg,
    sidebarAccent: secondary,
    sidebarAccentForeground: fg,
    sidebarBorder: border,
    sidebarRing: primary,
    iconColor: '',
  };

  return {
    id: `custom-${Date.now()}`,
    name: name || description.slice(0, 40),
    nameHe: name || description.slice(0, 40),
    colors,
    style: { density: 'comfortable', fontFamily: 'Assistant, sans-serif', fontSize: 14, fontWeight: 400, ...seed.style },
    isCustom: true,
  };
}
