import { useState, useEffect, useCallback, useRef } from "react";
import { useTheme, BUILT_IN_THEMES, type AppTheme, type ThemeColors, type ThemeStyleOptions } from "@/hooks/useTheme";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Rnd } from "react-rnd";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Check, Plus, Pencil, Trash2, Palette, Download, Upload, Sparkles, RotateCcw, Save, Copy, Minimize2, X } from "lucide-react";
import {
  contrastRatio,
  contrastLevel,
  contrastLabel,
  exportThemeToJson,
  importThemeFromJson,
  downloadFile,
  generateThemeFromDescription,
} from "@/lib/themeUtils";

const DEFAULT_STYLE: ThemeStyleOptions = {
  radius: 8,
  density: 'comfortable',
  fontFamily: 'Assistant, sans-serif',
  fontSize: 14,
  fontWeight: 400,
  shadow: 'soft',
};

const DEFAULT_COLORS: ThemeColors = { ...BUILT_IN_THEMES[0].colors };

// Color groups for the editor
const COLOR_GROUPS: { label: string; keys: { key: keyof ThemeColors; label: string }[] }[] = [
  {
    label: 'צבעים ראשיים',
    keys: [
      { key: 'background', label: 'רקע' },
      { key: 'foreground', label: 'טקסט' },
      { key: 'primary', label: 'צבע ראשי' },
      { key: 'primaryForeground', label: 'טקסט ראשי' },
      { key: 'accent', label: 'הדגשה' },
      { key: 'accentForeground', label: 'טקסט הדגשה' },
    ],
  },
  {
    label: 'כרטיסים ומסגרות',
    keys: [
      { key: 'card', label: 'כרטיס' },
      { key: 'cardForeground', label: 'טקסט כרטיס' },
      { key: 'border', label: 'מסגרת' },
      { key: 'input', label: 'שדה קלט' },
      { key: 'ring', label: 'טבעת פוקוס' },
    ],
  },
  {
    label: 'צבעים משניים',
    keys: [
      { key: 'secondary', label: 'משני' },
      { key: 'secondaryForeground', label: 'טקסט משני' },
      { key: 'muted', label: 'מעומעם' },
      { key: 'mutedForeground', label: 'טקסט מעומעם' },
    ],
  },
  {
    label: 'סרגל צד',
    keys: [
      { key: 'sidebarBackground', label: 'רקע' },
      { key: 'sidebarForeground', label: 'טקסט' },
      { key: 'sidebarPrimary', label: 'ראשי' },
      { key: 'sidebarBorder', label: 'מסגרת' },
    ],
  },
  {
    label: 'מיוחד',
    keys: [
      { key: 'iconColor', label: 'צבע אייקונים' },
      { key: 'destructive', label: 'שגיאה' },
    ],
  },
];

/** Plain-language description of what each color controls in the UI. */
const COLOR_DESCRIPTIONS: Partial<Record<keyof ThemeColors, string>> = {
  background: 'הרקע הראשי של כל האפליקציה',
  foreground: 'צבע הטקסט הראשי על הרקע',
  primary: 'כפתורים ראשיים, קישורים פעילים, סרגלי התקדמות',
  primaryForeground: 'טקסט על כפתור ראשי',
  accent: 'הדגשות, hover, רקע של פריט פעיל',
  accentForeground: 'טקסט על אזור הדגשה',
  card: 'רקע של כרטיסים, דיאלוגים וחלונות',
  cardForeground: 'טקסט בתוך כרטיסים',
  border: 'קווי מסגרת סביב כרטיסים ושדות',
  input: 'רקע ומסגרת של שדות קלט',
  ring: 'טבעת המסגרת סביב שדה בפוקוס',
  secondary: 'כפתורים משניים, רקע tabs',
  secondaryForeground: 'טקסט בכפתורים משניים',
  muted: 'רקע אזורים שקטים, badges, סטטוס',
  mutedForeground: 'טקסט משני, placeholder, תיאורים',
  sidebarBackground: 'רקע התפריט הצדדי',
  sidebarForeground: 'טקסט בתפריט הצדדי',
  sidebarPrimary: 'פריט פעיל בתפריט הצדדי',
  sidebarBorder: 'קו מפריד בתפריט הצדדי',
  iconColor: 'צבע אייקונים גלובלי באפליקציה',
  destructive: 'כפתורי מחיקה והודעות שגיאה',
};

/** Plain-language description for each style option. */
const STYLE_DESCRIPTIONS = {
  radius: 'משפיע על: כפתורים, כרטיסים, שדות קלט, badges',
  density: 'משפיע על: רווחים פנימיים בכל הרכיבים',
  fontFamily: 'משפיע על: כל הטקסט באפליקציה',
  fontSize: 'משפיע על: גודל הטקסט הבסיסי בכל המסכים',
  fontWeight: 'משפיע על: עובי כל הטקסטים',
  shadow: 'משפיע על: כרטיסים, dropdowns, dialogs',
} as const;

/** Quick palette presets — apply only the 4 primary colors, the rest stays. */
const PALETTE_PRESETS: { name: string; emoji: string; colors: Partial<ThemeColors> }[] = [
  { name: 'זהב מלכותי', emoji: '👑', colors: { background: '0 0% 100%', foreground: '220 60% 18%', primary: '43 74% 49%', primaryForeground: '0 0% 100%', accent: '43 74% 49%', accentForeground: '0 0% 100%' } },
  { name: 'אוקיינוס כחול', emoji: '🌊', colors: { background: '210 30% 98%', foreground: '215 50% 15%', primary: '210 80% 45%', primaryForeground: '0 0% 100%', accent: '195 75% 50%', accentForeground: '0 0% 100%' } },
  { name: 'יער עמוק', emoji: '🌲', colors: { background: '120 10% 98%', foreground: '140 30% 15%', primary: '142 55% 35%', primaryForeground: '0 0% 100%', accent: '160 50% 40%', accentForeground: '0 0% 100%' } },
  { name: 'אדמה חמה', emoji: '🔥', colors: { background: '30 30% 97%', foreground: '20 35% 15%', primary: '20 80% 45%', primaryForeground: '0 0% 100%', accent: '35 75% 55%', accentForeground: '20 60% 15%' } },
  { name: 'לילה כהה', emoji: '🌙', colors: { background: '220 20% 10%', foreground: '210 20% 95%', primary: '210 80% 60%', primaryForeground: '220 30% 10%', accent: '260 70% 65%', accentForeground: '0 0% 100%' } },
  { name: 'פסטל רך', emoji: '🌸', colors: { background: '340 30% 98%', foreground: '320 30% 20%', primary: '320 50% 60%', primaryForeground: '0 0% 100%', accent: '280 50% 65%', accentForeground: '0 0% 100%' } },
  { name: 'מינימליסט שחור-לבן', emoji: '⚫', colors: { background: '0 0% 100%', foreground: '0 0% 5%', primary: '0 0% 10%', primaryForeground: '0 0% 100%', accent: '0 0% 20%', accentForeground: '0 0% 100%' } },
  { name: 'תורני קלאסי', emoji: '📜', colors: { background: '40 25% 96%', foreground: '20 50% 12%', primary: '15 65% 35%', primaryForeground: '40 30% 98%', accent: '40 70% 45%', accentForeground: '20 60% 12%' } },
];

const FLOATING_EDITOR_LAYOUT_KEY = 'theme_editor_floating_layout_v1';

type FloatingEditorLayout = {
  width: number;
  height: number;
  x: number;
  y: number;
  minimized: boolean;
};

function getDefaultFloatingLayout(): FloatingEditorLayout {
  const width = Math.min(980, Math.max(720, window.innerWidth - 120));
  const height = Math.min(760, Math.max(520, window.innerHeight - 100));
  const x = Math.max(24, Math.round((window.innerWidth - width) / 2));
  const y = Math.max(24, Math.round((window.innerHeight - height) / 2));
  return { width, height, x, y, minimized: false };
}

function loadFloatingLayout(): FloatingEditorLayout {
  try {
    const raw = localStorage.getItem(FLOATING_EDITOR_LAYOUT_KEY);
    if (!raw) return getDefaultFloatingLayout();
    const parsed = JSON.parse(raw) as Partial<FloatingEditorLayout>;
    const fallback = getDefaultFloatingLayout();
    return {
      width: Number(parsed.width) || fallback.width,
      height: Number(parsed.height) || fallback.height,
      x: Number(parsed.x) || fallback.x,
      y: Number(parsed.y) || fallback.y,
      minimized: Boolean(parsed.minimized),
    };
  } catch {
    return getDefaultFloatingLayout();
  }
}

function saveFloatingLayout(layout: FloatingEditorLayout) {
  localStorage.setItem(FLOATING_EDITOR_LAYOUT_KEY, JSON.stringify(layout));
}

function hslToHex(hsl: string): string {
  if (!hsl || hsl === 'inherit') return '#daa520';
  const parts = hsl.trim().split(/\s+/);
  if (parts.length < 3) return '#888888';
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '0 0% 0%';
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function ThemePreview({ theme, isActive, onClick }: { theme: AppTheme; isActive: boolean; onClick: () => void }) {
  const bg = `hsl(${theme.colors.background})`;
  const fg = `hsl(${theme.colors.foreground})`;
  const primary = `hsl(${theme.colors.primary})`;
  const border = `hsl(${theme.colors.border})`;
  const card = `hsl(${theme.colors.card})`;
  const accent = `hsl(${theme.colors.accent})`;

  return (
    <button
      onClick={onClick}
      className={`relative rounded-xl p-3 text-right transition-all ${isActive ? 'ring-2 ring-offset-2 ring-primary scale-[1.02]' : 'hover:scale-[1.01]'}`}
      style={{ backgroundColor: bg, border: `2px solid ${border}` }}
    >
      {isActive && (
        <div className="absolute top-2 left-2 rounded-full p-1" style={{ backgroundColor: primary }}>
          <Check className="h-3 w-3 text-white" />
        </div>
      )}
      <div className="space-y-2">
        <div className="text-sm font-bold" style={{ color: fg }}>{theme.nameHe}</div>
        <div className="flex gap-1">
          <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: primary, borderColor: border }} />
          <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: accent, borderColor: border }} />
          <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: card, borderColor: border }} />
          <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: fg, borderColor: border }} />
        </div>
        <div className="flex gap-1">
          <div className="h-2 rounded-full" style={{ backgroundColor: primary, width: '60%' }} />
          <div className="h-2 rounded-full" style={{ backgroundColor: accent, width: '40%' }} />
        </div>
      </div>
    </button>
  );
}

function ThemeLivePreview({ colors, style, name, variant, highlightKey }: {
  colors: ThemeColors;
  style: ThemeStyleOptions;
  name: string;
  variant: 'light' | 'dark';
  highlightKey?: keyof ThemeColors | null;
}) {
  const shadowMap: Record<string, string> = {
    none: 'none',
    soft: '0 1px 3px rgb(0 0 0 / 0.06)',
    medium: '0 4px 6px -1px rgb(0 0 0 / 0.10)',
    strong: '0 20px 25px -5px rgb(0 0 0 / 0.18)',
  };
  const radius = typeof style.radius === 'number' ? `${style.radius}px` : '8px';
  const innerRadius = typeof style.radius === 'number' ? `${Math.max(0, style.radius - 2)}px` : '6px';
  const densityPad = style.density === 'compact' ? '0.5rem' : style.density === 'spacious' ? '1rem' : '0.75rem';

  // Region wrapper: pulses + outlines when its color key matches highlightKey
  const ringClass = (k: keyof ThemeColors | string) =>
    highlightKey === k
      ? 'outline outline-2 outline-offset-2 outline-yellow-500 animate-pulse'
      : 'transition-all';

  return (
    <div
      data-color-key="background"
      className={`rounded-xl p-4 space-y-3 ${ringClass('background')}`}
      style={{
        backgroundColor: `hsl(${colors.background})`,
        border: `2px solid hsl(${colors.border})`,
        borderRadius: radius,
        fontFamily: style.fontFamily || undefined,
        fontSize: typeof style.fontSize === 'number' ? `${style.fontSize}px` : undefined,
        fontWeight: style.fontWeight || undefined,
        boxShadow: shadowMap[style.shadow || 'soft'],
        padding: densityPad,
      }}
    >
      {/* Header with foreground text */}
      <div
        data-color-key="foreground"
        className={`font-bold flex items-center justify-between ${ringClass('foreground')}`}
        style={{ color: `hsl(${colors.foreground})`, fontSize: '1.05em' }}
      >
        <span>{name}</span>
        {variant === 'dark' && <span className="text-[10px] opacity-60">🌙</span>}
        {variant === 'light' && <span className="text-[10px] opacity-60">☀️</span>}
      </div>

      {/* Mini sidebar + main split */}
      <div className="grid grid-cols-[1fr_2.5fr] gap-2">
        {/* Sidebar */}
        <div
          data-color-key="sidebarBackground"
          className={`p-2 space-y-1 text-[10px] ${ringClass('sidebarBackground')}`}
          style={{
            backgroundColor: `hsl(${colors.sidebarBackground})`,
            border: `1px solid hsl(${colors.sidebarBorder})`,
            borderRadius: innerRadius,
          }}
        >
          <div data-color-key="sidebarForeground" className={ringClass('sidebarForeground')} style={{ color: `hsl(${colors.sidebarForeground})` }}>תפריט</div>
          <div data-color-key="sidebarPrimary" className={`px-1.5 py-0.5 ${ringClass('sidebarPrimary')}`} style={{ backgroundColor: `hsl(${colors.sidebarPrimary})`, color: `hsl(${colors.sidebarPrimaryForeground})`, borderRadius: innerRadius }}>פעיל</div>
          <div data-color-key="sidebarBorder" className={`h-px ${ringClass('sidebarBorder')}`} style={{ backgroundColor: `hsl(${colors.sidebarBorder})` }} />
          <div style={{ color: `hsl(${colors.sidebarForeground})`, opacity: 0.7 }}>פריט</div>
        </div>

        {/* Card area */}
        <div
          data-color-key="card"
          className={`p-3 space-y-2 ${ringClass('card')}`}
          style={{
            backgroundColor: `hsl(${colors.card})`,
            border: `1px solid hsl(${colors.border})`,
            borderRadius: innerRadius,
          }}
        >
          <div data-color-key="cardForeground" className={`text-xs ${ringClass('cardForeground')}`} style={{ color: `hsl(${colors.cardForeground})` }}>טקסט בכרטיס לדוגמה</div>
          <div data-color-key="mutedForeground" className={`text-[10px] ${ringClass('mutedForeground')}`} style={{ color: `hsl(${colors.mutedForeground})` }}>טקסט משני / placeholder</div>

          {/* Input field */}
          <div
            data-color-key="input"
            className={`text-[10px] px-2 py-1 ${ringClass('input')}`}
            style={{
              backgroundColor: `hsl(${colors.input})`,
              border: `1px solid hsl(${colors.border})`,
              borderRadius: innerRadius,
              color: `hsl(${colors.foreground})`,
              boxShadow: highlightKey === 'ring' ? `0 0 0 2px hsl(${colors.ring})` : undefined,
            }}
          >
            <span data-color-key="ring">שדה קלט {highlightKey === 'ring' ? '(בפוקוס)' : ''}</span>
          </div>

          {/* Button row */}
          <div className="flex gap-1 flex-wrap">
            <div data-color-key="primary" className={`text-[10px] px-2 py-1 ${ringClass('primary')}`} style={{ backgroundColor: `hsl(${colors.primary})`, color: `hsl(${colors.primaryForeground})`, borderRadius: innerRadius }}>
              <span data-color-key="primaryForeground" className={ringClass('primaryForeground')}>ראשי</span>
            </div>
            <div data-color-key="accent" className={`text-[10px] px-2 py-1 ${ringClass('accent')}`} style={{ backgroundColor: `hsl(${colors.accent})`, color: `hsl(${colors.accentForeground})`, borderRadius: innerRadius }}>
              <span data-color-key="accentForeground" className={ringClass('accentForeground')}>הדגשה</span>
            </div>
            <div data-color-key="secondary" className={`text-[10px] px-2 py-1 ${ringClass('secondary')}`} style={{ backgroundColor: `hsl(${colors.secondary})`, color: `hsl(${colors.secondaryForeground})`, borderRadius: innerRadius }}>
              <span data-color-key="secondaryForeground" className={ringClass('secondaryForeground')}>משני</span>
            </div>
            <div data-color-key="destructive" className={`text-[10px] px-2 py-1 ${ringClass('destructive')}`} style={{ backgroundColor: `hsl(${colors.destructive})`, color: `hsl(${colors.destructiveForeground})`, borderRadius: innerRadius }}>שגיאה</div>
          </div>

          {/* Muted badge row */}
          <div className="flex gap-1 items-center">
            <span data-color-key="muted" className={`text-[10px] px-2 py-0.5 ${ringClass('muted')}`} style={{ backgroundColor: `hsl(${colors.muted})`, color: `hsl(${colors.mutedForeground})`, borderRadius: innerRadius }}>badge</span>
            <span data-color-key="iconColor" className={`text-[10px] ${ringClass('iconColor')}`} style={{ color: colors.iconColor || `hsl(${colors.foreground})` }}>★ אייקון</span>
          </div>
        </div>
      </div>

      {/* Border bottom strip */}
      <div data-color-key="border" className={`h-px ${ringClass('border')}`} style={{ backgroundColor: `hsl(${colors.border})` }} />
    </div>
  );
}

/** Build an approximated dark variant of given colors for side-by-side preview. */
function invertColorsForPreview(colors: ThemeColors): ThemeColors {
  const flip = (hsl: string): string => {
    const parts = hsl.replace(/hsl\(|\)/g, '').trim().split(/\s+/);
    if (parts.length < 3) return hsl;
    const h = parts[0];
    const s = parts[1];
    const l = parseFloat(parts[2]);
    if (isNaN(l)) return hsl;
    return `${h} ${s} ${100 - l}%`;
  };
  return {
    ...colors,
    background: flip(colors.background),
    foreground: flip(colors.foreground),
    card: flip(colors.card),
    cardForeground: flip(colors.cardForeground),
    popover: flip(colors.popover),
    popoverForeground: flip(colors.popoverForeground),
    secondary: flip(colors.secondary),
    secondaryForeground: flip(colors.secondaryForeground),
    muted: flip(colors.muted),
    mutedForeground: flip(colors.mutedForeground),
    border: flip(colors.border),
    input: flip(colors.input),
    sidebarBackground: flip(colors.sidebarBackground),
    sidebarForeground: flip(colors.sidebarForeground),
    sidebarAccent: flip(colors.sidebarAccent),
    sidebarAccentForeground: flip(colors.sidebarAccentForeground),
    sidebarBorder: flip(colors.sidebarBorder),
  };
}

/** Small WCAG contrast badge for a foreground/background pair. */
function ContrastBadge({ fg, bg }: { fg: string; bg: string }) {
  const ratio = contrastRatio(fg, bg);
  const level = contrastLevel(ratio);
  const color = level === 'aaa' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
    : level === 'aa' ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400'
    : level === 'aa-large' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-500'
    : 'bg-red-500/15 text-red-700 dark:text-red-400';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums ${color}`}
      title={contrastLabel(level)}
    >
      {ratio.toFixed(1)}:1
    </span>
  );
}

interface EditorSnapshot {
  name: string;
  colors: ThemeColors;
  style: ThemeStyleOptions;
}

function ThemeEditor({ initial, onSave, onDuplicate, onCancel, isBuiltIn, onPreviewChange, onDirtyChange }: {
  initial?: AppTheme;
  onSave: (theme: AppTheme) => void;
  onDuplicate?: (theme: AppTheme) => void;
  onCancel: () => void;
  isBuiltIn?: boolean;
  onPreviewChange?: (theme: AppTheme) => void;
  onDirtyChange?: (isDirty: boolean) => void;
}) {
  const [name, setName] = useState(initial?.nameHe || '');
  const [colors, setColors] = useState<ThemeColors>(initial?.colors || { ...DEFAULT_COLORS });
  const [style, setStyle] = useState<ThemeStyleOptions>(initial?.style || { ...DEFAULT_STYLE });
  const [showDarkPreview, setShowDarkPreview] = useState(false);

  // What the user is currently hovering / changed — drives highlight ring in preview
  const [highlightKey, setHighlightKey] = useState<keyof ThemeColors | null>(null);
  const [flashKey, setFlashKey] = useState<keyof ThemeColors | null>(null);
  const flashTimer = useRef<number | null>(null);
  const showHighlight = highlightKey ?? flashKey;

  // Undo / Redo history
  const historyRef = useRef<EditorSnapshot[]>([]);
  const redoRef = useRef<EditorSnapshot[]>([]);
  const skipHistoryRef = useRef(false);
  const [historyVersion, setHistoryVersion] = useState(0); // re-render trigger for can-undo state

  // push current to history before changing
  const pushHistory = useCallback(() => {
    historyRef.current.push({ name, colors: { ...colors }, style: { ...style } });
    if (historyRef.current.length > 50) historyRef.current.shift();
    redoRef.current = [];
    setHistoryVersion(v => v + 1);
  }, [name, colors, style]);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    redoRef.current.push({ name, colors: { ...colors }, style: { ...style } });
    skipHistoryRef.current = true;
    setName(prev.name);
    setColors(prev.colors);
    setStyle(prev.style);
    setHistoryVersion(v => v + 1);
    toast.info('בוטל הצעד האחרון');
  }, [name, colors, style]);

  const redo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push({ name, colors: { ...colors }, style: { ...style } });
    skipHistoryRef.current = true;
    setName(next.name);
    setColors(next.colors);
    setStyle(next.style);
    setHistoryVersion(v => v + 1);
    toast.info('הצעד שוחזר');
  }, [name, colors, style]);

  // Flash the changed region in preview for 1.5s
  const triggerFlash = (key: keyof ThemeColors) => {
    setFlashKey(key);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashKey(null), 1500);
  };

  const resetStyleField = <K extends keyof ThemeStyleOptions>(key: K) => {
    pushHistory();
    setStyle(prev => ({ ...prev, [key]: DEFAULT_STYLE[key] }));
  };
  const resetAllStyle = () => {
    pushHistory();
    setStyle({ ...DEFAULT_STYLE });
  };

  const updateColor = (key: keyof ThemeColors, hex: string) => {
    pushHistory();
    triggerFlash(key);
    if (key === 'iconColor') {
      setColors(prev => ({ ...prev, [key]: hex ? `hsl(${hexToHsl(hex)})` : '' }));
    } else {
      setColors(prev => ({ ...prev, [key]: hexToHsl(hex) }));
    }
  };

  const updateStyle = <K extends keyof ThemeStyleOptions>(key: K, value: ThemeStyleOptions[K]) => {
    pushHistory();
    setStyle(prev => ({ ...prev, [key]: value }));
  };

  // Apply a quick palette preset: overrides only the keys in the preset
  const applyPalette = (preset: typeof PALETTE_PRESETS[number]) => {
    pushHistory();
    setColors(prev => ({ ...prev, ...preset.colors } as ThemeColors));
    toast.success(`הוחלה פלטה: ${preset.emoji} ${preset.name}`);
  };

  useEffect(() => {
    const previewTheme: AppTheme = {
      id: initial?.id || 'theme-preview',
      name: (name || initial?.nameHe || 'תצוגה מקדימה').trim(),
      nameHe: (name || initial?.nameHe || 'תצוגה מקדימה').trim(),
      colors,
      style,
      isCustom: true,
    };
    onPreviewChange?.(previewTheme);
  }, [name, colors, style, initial?.id, initial?.nameHe, onPreviewChange]);

  useEffect(() => {
    const initialName = initial?.nameHe || '';
    const initialColors = initial?.colors || DEFAULT_COLORS;
    const initialStyle = initial?.style || DEFAULT_STYLE;
    const dirty =
      name !== initialName ||
      JSON.stringify(colors) !== JSON.stringify(initialColors) ||
      JSON.stringify(style) !== JSON.stringify(initialStyle);
    onDirtyChange?.(dirty);
  }, [name, colors, style, initial, onDirtyChange]);

  // Keyboard: Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'y') || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const getHex = (key: keyof ThemeColors) => {
    const val = colors[key];
    if (!val || val === 'inherit') return '';
    if (val.startsWith('hsl(')) {
      return hslToHex(val.replace('hsl(', '').replace(')', ''));
    }
    return hslToHex(val);
  };

  const handleOverwrite = () => {
    if (!name.trim()) {
      toast.error('יש להזין שם לערכת הנושא');
      return;
    }
    const id = initial?.id || `custom-${Date.now()}`;
    onSave({ id, name: name.trim(), nameHe: name.trim(), colors, style, isCustom: true });
  };

  const handleDuplicate = () => {
    if (!name.trim()) {
      toast.error('יש להזין שם לערכת הנושא');
      return;
    }
    const newTheme: AppTheme = {
      id: `custom-${Date.now()}`,
      name: name.trim(),
      nameHe: name.trim(),
      colors,
      style,
      isCustom: true,
    };
    (onDuplicate || onSave)(newTheme);
  };

  // Listen for Ctrl+S dispatched from the floating window header
  useEffect(() => {
    const onSaveEvent = () => { if (!isBuiltIn) handleOverwrite(); else handleDuplicate(); };
    window.addEventListener('theme-editor-save', onSaveEvent);
    return () => window.removeEventListener('theme-editor-save', onSaveEvent);
  });

  const canUndo = historyRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  return (
    <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1" dir="rtl">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>שם ערכת הנושא</Label>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canUndo} onClick={undo} title="בטל (Ctrl+Z)">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canRedo} onClick={redo} title="בצע שוב (Ctrl+Y)">
              <RotateCcw className="h-3.5 w-3.5 scale-x-[-1]" />
            </Button>
            <span className="text-[10px] text-muted-foreground tabular-nums px-1">
              {historyRef.current.length}/{historyRef.current.length + redoRef.current.length} צעדים
            </span>
          </div>
        </div>
        <Input value={name} onChange={e => { if (!skipHistoryRef.current) pushHistory(); skipHistoryRef.current = false; setName(e.target.value); }} placeholder="שם הערכה..." />
      </div>

      {/* Quick palette presets */}
      <div className="space-y-2 rounded-lg border border-border/40 p-3 bg-muted/10">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">פלטות מוכנות — לחיצה מחילה ארבעת הצבעים הראשיים</Label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PALETTE_PRESETS.map(p => (
            <button
              key={p.name}
              type="button"
              onClick={() => applyPalette(p)}
              className="group flex items-center gap-1.5 rounded-md border border-border/50 px-2 py-1 text-[11px] hover:bg-accent hover:text-accent-foreground transition-colors"
              title={`החל פלטה: ${p.name}`}
            >
              <span>{p.emoji}</span>
              <span>{p.name}</span>
              <span className="flex gap-0.5">
                {(['primary', 'accent', 'background', 'foreground'] as const).map(k => (
                  <span key={k} className="h-2 w-2 rounded-full border border-border/40" style={{ backgroundColor: p.colors[k] ? `hsl(${p.colors[k]})` : 'transparent' }} />
                ))}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Live preview — single or dual */}
      <div className="space-y-2 sticky top-0 z-10 bg-background pt-2 pb-1 -mt-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            תצוגה מקדימה חיה {showHighlight && <span className="text-yellow-600 font-semibold">· מסומן: {COLOR_DESCRIPTIONS[showHighlight] || showHighlight}</span>}
          </Label>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground" htmlFor="dual-preview">השוואת בהיר/כהה</Label>
            <Switch id="dual-preview" checked={showDarkPreview} onCheckedChange={setShowDarkPreview} />
          </div>
        </div>
        <div className={showDarkPreview ? 'grid grid-cols-2 gap-3' : ''}>
          <ThemeLivePreview colors={colors} style={style} name={name || 'תצוגה מקדימה חיה'} variant="light" highlightKey={showHighlight} />
          {showDarkPreview && <ThemeLivePreview colors={invertColorsForPreview(colors)} style={style} name={`${name || 'תצוגה מקדימה'} (כהה)`} variant="dark" highlightKey={showHighlight} />}
        </div>
        <div className="text-[10px] text-muted-foreground">💡 רחף מעל פקד כדי לראות מה הוא משנה בתצוגה למעלה. שינוי יבליט את האזור המושפע למשך 1.5 שניות.</div>
      </div>

      <Tabs defaultValue="colors" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="colors">🎨 צבעים</TabsTrigger>
          <TabsTrigger value="style">✨ עיצוב וסגנון</TabsTrigger>
        </TabsList>

        <TabsContent value="colors" className="space-y-4 mt-4">
          {/* WCAG contrast summary */}
          <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1.5">
            <h4 className="text-xs font-semibold text-muted-foreground">בדיקת ניגוד WCAG</h4>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span>טקסט ראשי על רקע</span>
                <ContrastBadge fg={colors.foreground} bg={colors.background} />
              </div>
              <div className="flex items-center justify-between">
                <span>טקסט ראשי על כפתור</span>
                <ContrastBadge fg={colors.primaryForeground} bg={colors.primary} />
              </div>
              <div className="flex items-center justify-between">
                <span>טקסט הדגשה</span>
                <ContrastBadge fg={colors.accentForeground} bg={colors.accent} />
              </div>
              <div className="flex items-center justify-between">
                <span>טקסט בכרטיס</span>
                <ContrastBadge fg={colors.cardForeground} bg={colors.card} />
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">AA = 4.5:1 · AAA = 7:1 — ניגוד נמוך פוגע בנגישות</div>
          </div>

          {COLOR_GROUPS.map(group => (
            <div key={group.label} className="space-y-2.5">
              <h4 className="text-sm font-semibold text-muted-foreground">{group.label}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.keys.map(({ key, label }) => {
                  const desc = COLOR_DESCRIPTIONS[key];
                  const isHi = showHighlight === key;
                  return (
                    <div
                      key={key}
                      onMouseEnter={() => setHighlightKey(key)}
                      onMouseLeave={() => setHighlightKey(null)}
                      onFocus={() => setHighlightKey(key)}
                      onBlur={() => setHighlightKey(null)}
                      className={`flex items-start gap-2.5 rounded-md border p-2 transition-colors cursor-help ${isHi ? 'border-yellow-500 bg-yellow-500/5' : 'border-border/40 bg-muted/20 hover:border-yellow-500/50'}`}
                      title={desc || label}
                    >
                      <input
                        type="color"
                        value={getHex(key) || '#daa520'}
                        onChange={e => updateColor(key, e.target.value)}
                        className="w-9 h-9 rounded border cursor-pointer shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium">{label}</div>
                        {desc && <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{desc}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="style" className="space-y-5 mt-4">
          {/* Reset all */}
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={resetAllStyle} className="gap-1 text-xs h-7">
              <RotateCcw className="h-3 w-3" />
              אפס הכל לברירת מחדל
            </Button>
          </div>

          {/* Border radius */}
          <div className="space-y-2 rounded-lg border border-border/40 p-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <Label className="text-sm">עיגול פינות</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={20}
                  value={style.radius ?? 8}
                  onChange={e => updateStyle('radius', Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
                  className="h-6 w-14 text-xs text-center px-1"
                />
                <span className="text-[10px] text-muted-foreground">px</span>
                <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => resetStyleField('radius')} title="אפס">
                  <RotateCcw className="h-3 w-3" />
                </Button>
              </div>
            </div>
            <Slider min={0} max={20} step={1} value={[style.radius ?? 8]} onValueChange={(v) => updateStyle('radius', v[0])} />
            <div className="text-[10px] text-muted-foreground">{STYLE_DESCRIPTIONS.radius} · 0 = פינות חדות · 20 = עגול מאוד</div>
          </div>

          {/* Density */}
          <div className="space-y-2 rounded-lg border border-border/40 p-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <Label className="text-sm">צפיפות הממשק</Label>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => resetStyleField('density')} title="אפס">
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
            <Select value={style.density || 'comfortable'} onValueChange={(v) => updateStyle('density', v as ThemeStyleOptions['density'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="compact">צפוף — חוסך מקום</SelectItem>
                <SelectItem value="comfortable">רגיל — מומלץ</SelectItem>
                <SelectItem value="spacious">מרווח — נוח לעין</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-[10px] text-muted-foreground">{STYLE_DESCRIPTIONS.density}</div>
          </div>

          {/* Font family */}
          <div className="space-y-2 rounded-lg border border-border/40 p-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <Label className="text-sm">גופן</Label>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => resetStyleField('fontFamily')} title="אפס">
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
            <Select value={style.fontFamily || 'Assistant, sans-serif'} onValueChange={(v) => updateStyle('fontFamily', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Assistant, sans-serif">Assistant (ברירת מחדל)</SelectItem>
                <SelectItem value="'Heebo', sans-serif">Heebo</SelectItem>
                <SelectItem value="'Rubik', sans-serif">Rubik</SelectItem>
                <SelectItem value="'Frank Ruhl Libre', serif">Frank Ruhl Libre — מסורתי</SelectItem>
                <SelectItem value="'David Libre', serif">David Libre — תורני</SelectItem>
                <SelectItem value="'Noto Sans Hebrew', sans-serif">Noto Sans Hebrew</SelectItem>
                <SelectItem value="'Open Sans Hebrew', sans-serif">Open Sans Hebrew</SelectItem>
                <SelectItem value="system-ui, sans-serif">מערכת</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-[10px] text-muted-foreground">{STYLE_DESCRIPTIONS.fontFamily}</div>
          </div>

          {/* Font size + weight */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2 rounded-lg border border-border/40 p-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <Label className="text-sm">גודל גופן</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={11}
                    max={20}
                    value={style.fontSize ?? 14}
                    onChange={e => updateStyle('fontSize', Math.max(11, Math.min(20, Number(e.target.value) || 14)))}
                    className="h-6 w-12 text-xs text-center px-1"
                  />
                  <span className="text-[10px] text-muted-foreground">px</span>
                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => resetStyleField('fontSize')} title="אפס">
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <Slider min={11} max={20} step={1} value={[style.fontSize ?? 14]} onValueChange={(v) => updateStyle('fontSize', v[0])} />
              <div className="text-[9px] text-muted-foreground">{STYLE_DESCRIPTIONS.fontSize}</div>
            </div>
            <div className="space-y-2 rounded-lg border border-border/40 p-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <Label className="text-sm">עובי גופן</Label>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={300}
                    max={800}
                    step={100}
                    value={style.fontWeight ?? 400}
                    onChange={e => updateStyle('fontWeight', Math.max(300, Math.min(800, Number(e.target.value) || 400)))}
                    className="h-6 w-14 text-xs text-center px-1"
                  />
                  <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => resetStyleField('fontWeight')} title="אפס">
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <Slider min={300} max={800} step={100} value={[style.fontWeight ?? 400]} onValueChange={(v) => updateStyle('fontWeight', v[0])} />
              <div className="text-[9px] text-muted-foreground">{STYLE_DESCRIPTIONS.fontWeight}</div>
            </div>
          </div>

          {/* Shadow */}
          <div className="space-y-2 rounded-lg border border-border/40 p-3 bg-muted/20">
            <div className="flex items-center justify-between">
              <Label className="text-sm">צל וטשטוש</Label>
              <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => resetStyleField('shadow')} title="אפס">
                <RotateCcw className="h-3 w-3" />
              </Button>
            </div>
            <Select value={style.shadow || 'soft'} onValueChange={(v) => updateStyle('shadow', v as ThemeStyleOptions['shadow'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">ללא צל — שטוח</SelectItem>
                <SelectItem value="soft">עדין — מומלץ</SelectItem>
                <SelectItem value="medium">בינוני</SelectItem>
                <SelectItem value="strong">חזק — תלת-ממד</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-[10px] text-muted-foreground">{STYLE_DESCRIPTIONS.shadow}</div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex gap-2 sticky bottom-0 bg-background border-t border-border/40 -mx-1 px-1 pt-3">
        {!isBuiltIn && (
          <Button onClick={handleOverwrite} className="flex-1 gap-2" title="Ctrl+S">
            <Save className="h-4 w-4" />
            שמור <span className="text-[10px] opacity-70">(Ctrl+S)</span>
          </Button>
        )}
        <Button onClick={handleDuplicate} variant={isBuiltIn ? "default" : "outline"} className="flex-1 gap-2">
          <Copy className="h-4 w-4" />
          {isBuiltIn ? 'שכפל ושמור' : 'שכפל כחדש'}
        </Button>
        <Button variant="ghost" onClick={onCancel}>ביטול</Button>
      </div>
    </div>
  );
}

function FloatingThemeEditorWindow({
  open,
  title,
  initial,
  isBuiltIn,
  onSave,
  onDuplicate,
  onClose,
  onPreview,
}: {
  open: boolean;
  title: string;
  initial: AppTheme;
  isBuiltIn?: boolean;
  onSave: (theme: AppTheme) => void;
  onDuplicate: (theme: AppTheme) => void;
  onClose: () => void;
  onPreview: (theme: AppTheme) => void;
}) {
  const [layout, setLayout] = useState<FloatingEditorLayout>(() => loadFloatingLayout());
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const ok = !isDirty || window.confirm('יש שינויים שלא נשמרו. לסגור בלי לשמור?');
        if (ok) onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('theme-editor-save'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isDirty, onClose]);

  if (!open) return null;

  const requestClose = () => {
    if (!isDirty || window.confirm('יש שינויים שלא נשמרו. לסגור בלי לשמור?')) {
      onClose();
    }
  };

  const persistLayout = (next: FloatingEditorLayout) => {
    setLayout(next);
    saveFloatingLayout(next);
  };

  return createPortal(
    <>
      {layout.minimized && (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-[70] inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background shadow-lg"
          onClick={() => persistLayout({ ...layout, minimized: false })}
          title="שחזור עורך ערכת נושא"
        >
          <Palette className="h-5 w-5" />
        </button>
      )}

      {!layout.minimized && (
        <Rnd
          size={{ width: layout.width, height: layout.height }}
          position={{ x: layout.x, y: layout.y }}
          minWidth={640}
          minHeight={420}
          maxWidth={Math.max(740, window.innerWidth - 24)}
          maxHeight={Math.max(460, window.innerHeight - 24)}
          bounds="window"
          dragHandleClassName="theme-editor-drag-handle"
          onDragStop={(_, d) => persistLayout({ ...layout, x: d.x, y: d.y })}
          onResizeStop={(_, __, ref, ___, position) => {
            persistLayout({
              ...layout,
              width: ref.offsetWidth,
              height: ref.offsetHeight,
              x: position.x,
              y: position.y,
            });
          }}
          className="z-[70]"
          enableResizing={{ top: true, right: true, bottom: true, left: true, topLeft: true, topRight: true, bottomLeft: true, bottomRight: true }}
          resizeHandleClasses={{
            top: 'theme-editor-resize-handle theme-editor-resize-handle-top',
            right: 'theme-editor-resize-handle theme-editor-resize-handle-right',
            bottom: 'theme-editor-resize-handle theme-editor-resize-handle-bottom',
            left: 'theme-editor-resize-handle theme-editor-resize-handle-left',
            topLeft: 'theme-editor-resize-handle theme-editor-resize-handle-corner',
            topRight: 'theme-editor-resize-handle theme-editor-resize-handle-corner',
            bottomLeft: 'theme-editor-resize-handle theme-editor-resize-handle-corner',
            bottomRight: 'theme-editor-resize-handle theme-editor-resize-handle-corner',
          }}
        >
          <div className="flex h-full flex-col rounded-xl border border-border bg-background shadow-2xl">
            <div className="theme-editor-drag-handle flex cursor-move items-center justify-between gap-2 border-b border-border/50 px-3 py-2 select-none">
              <div className="text-sm font-semibold">{title}</div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => persistLayout({ ...layout, minimized: true })}
                  title="מזער"
                >
                  <Minimize2 className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={requestClose} title="סגור">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="px-4 py-2 text-[11px] text-muted-foreground border-b border-border/30">
              תצוגה חיה פעילה על כל האפליקציה. השינויים נשמרים רק בלחיצה על שמור או שכפל ושמור.
            </div>

            <div className="min-h-0 flex-1 overflow-hidden px-2 pb-2">
              <ThemeEditor
                initial={initial}
                onSave={onSave}
                onDuplicate={onDuplicate}
                onCancel={requestClose}
                isBuiltIn={isBuiltIn}
                onPreviewChange={onPreview}
                onDirtyChange={setIsDirty}
              />
            </div>
          </div>
        </Rnd>
      )}
    </>,
    document.body,
  );
}

export function ThemeManager() {
  const { activeThemeId, allThemes, setTheme, applyThemePreview, reapplyActiveTheme, saveCustomTheme, deleteCustomTheme, customThemes } = useTheme();
  const { updatePreferences } = useCloudPreferences();
  const [isCreating, setIsCreating] = useState(false);
  const [floatingEditor, setFloatingEditor] = useState<{ open: boolean; title: string; initial: AppTheme; isBuiltIn: boolean } | null>(null);
  const [themeBeforeEditing, setThemeBeforeEditing] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiName, setAiName] = useState('');
  const [aiPreview, setAiPreview] = useState<AppTheme | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'saved'>('idle');
  const syncTimerRef = useRef<number | null>(null);

  const openFloatingEditor = (initial: AppTheme, title: string, isBuiltIn = false) => {
    setThemeBeforeEditing(activeThemeId);
    setFloatingEditor({ open: true, title, initial, isBuiltIn });
    applyThemePreview({ colors: initial.colors, style: initial.style });
  };

  const closeFloatingEditor = () => {
    setFloatingEditor(null);
    if (themeBeforeEditing) {
      setTheme(themeBeforeEditing);
    } else {
      reapplyActiveTheme();
    }
    setThemeBeforeEditing(null);
  };

  const syncThemeToCloud = async (themeId: string) => {
    setSyncStatus('syncing');
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    try {
      const customJson = localStorage.getItem('app_custom_themes') || '[]';
      await updatePreferences({ theme: themeId, custom_themes: customJson });
      setSyncStatus('saved');
      syncTimerRef.current = window.setTimeout(() => setSyncStatus('idle'), 2500);
    } catch {
      setSyncStatus('idle');
    }
  };

  // Toast on cross-device theme update from realtime
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ source?: string; themeId?: string }>).detail;
      if (detail?.source === 'remote') {
        const t = allThemes.find(x => x.id === detail.themeId);
        toast.info(`✨ הערכה עודכנה ממכשיר אחר${t ? `: ${t.nameHe}` : ''}`);
      }
    };
    window.addEventListener('cloud-theme-external-update', handler);
    return () => window.removeEventListener('cloud-theme-external-update', handler);
  }, [allThemes]);

  const handleSave = (theme: AppTheme) => {
    saveCustomTheme(theme);
    setTheme(theme.id);
    setFloatingEditor(null);
    setThemeBeforeEditing(null);
    setIsCreating(false);
    setTimeout(() => syncThemeToCloud(theme.id), 0);
    toast.success(`ערכת הנושא "${theme.nameHe}" נשמרה!`);
  };

  const handleDuplicate = (theme: AppTheme) => {
    saveCustomTheme(theme);
    setTheme(theme.id);
    setFloatingEditor(null);
    setThemeBeforeEditing(null);
    setIsCreating(false);
    setTimeout(() => syncThemeToCloud(theme.id), 0);
    toast.success(`ערכת הנושא "${theme.nameHe}" שוכפלה ונשמרה!`);
  };

  const handleExportActive = () => {
    const active = allThemes.find(t => t.id === activeThemeId);
    if (!active) { toast.error('לא נמצאה ערכת נושא פעילה'); return; }
    const json = exportThemeToJson(active);
    const safeName = (active.name || 'theme').replace(/[^\w-]+/g, '-');
    downloadFile(`${safeName}.theme.json`, json);
    toast.success(`ערכת הנושא "${active.nameHe}" יוצאה`);
  };

  const handleExportAllCustom = () => {
    if (customThemes.length === 0) { toast.error('אין ערכות אישיות לייצוא'); return; }
    const json = JSON.stringify({ __type: 'smart-hebrew-transcriber-themes-bundle', version: 1, themes: customThemes }, null, 2);
    downloadFile(`themes-bundle-${Date.now()}.json`, json);
    toast.success(`${customThemes.length} ערכות יוצאו`);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Bundle?
      if (Array.isArray(parsed.themes)) {
        let count = 0;
        for (const t of parsed.themes) {
          const imported = importThemeFromJson(JSON.stringify({ theme: t }));
          if (imported) { saveCustomTheme(imported); count++; }
        }
        if (count > 0) { setTimeout(() => syncThemeToCloud(activeThemeId), 100); toast.success(`יובאו ${count} ערכות נושא`); }
        else toast.error('לא נמצאו ערכות תקינות בקובץ');
      } else {
        const imported = importThemeFromJson(text);
        if (!imported) { toast.error('קובץ לא תקין'); return; }
        saveCustomTheme(imported);
        setTheme(imported.id);
        setTimeout(() => syncThemeToCloud(imported.id), 100);
        toast.success(`ערכת הנושא "${imported.nameHe}" יובאה והופעלה`);
      }
    } catch {
      toast.error('שגיאה בקריאת הקובץ');
    }
  };

  const handleAiGenerate = () => {
    if (!aiDescription.trim()) { toast.error('הזן תיאור לערכת הנושא'); return; }
    const generated = generateThemeFromDescription(aiDescription, aiName.trim() || undefined);
    setAiPreview(generated);
  };

  const handleAiSave = () => {
    if (!aiPreview) return;
    saveCustomTheme(aiPreview);
    setTheme(aiPreview.id);
    setTimeout(() => syncThemeToCloud(aiPreview.id), 100);
    toast.success(`ערכת AI "${aiPreview.nameHe}" נוצרה ונשמרה!`);
    setAiOpen(false);
    setAiDescription('');
    setAiName('');
    setAiPreview(null);
  };

  return (
    <div className="space-y-8" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Palette className="h-5 w-5" />
            ערכות נושא
            {syncStatus === 'syncing' && <span className="text-[10px] font-normal text-muted-foreground animate-pulse">⟳ מסנכרן...</span>}
            {syncStatus === 'saved' && <span className="text-[10px] font-normal text-emerald-600 dark:text-emerald-400">✓ סונכרן לענן</span>}
          </h3>
          <p className="text-sm text-muted-foreground">בחר ערכת נושא, ערוך צבעים וסגנון — הכל מסתנכרן אוטומטית בין מכשירים <kbd className="px-1.5 py-0.5 text-[10px] rounded bg-muted border ml-1">Ctrl+Shift+T</kbd></p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* AI Generator */}
          <Dialog open={aiOpen} onOpenChange={(open) => { setAiOpen(open); if (!open) setAiPreview(null); }}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Sparkles className="h-4 w-4" />
                יצירה עם AI
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl" dir="rtl">
              <DialogHeader>
                <DialogTitle>יצירת ערכת נושא עם AI</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>תאר את הערכה</Label>
                  <Textarea
                    rows={3}
                    placeholder="לדוגמה: ערכה חמה בסגנון תורני · ערכה כהה ומודרנית · פסטל רך · יוקרתי בזהב..."
                    value={aiDescription}
                    onChange={e => setAiDescription(e.target.value)}
                  />
                  <div className="text-[10px] text-muted-foreground">מילות מפתח שעובדות: כהה/לילה · חם/אדום · קר/כחול/ים · ירוק/טבע · סגול/מלכותי · זהב/יוקרה · תורני/חרדי · מינימליסט</div>
                </div>
                <div className="space-y-1.5">
                  <Label>שם ערכה (לא חובה)</Label>
                  <Input value={aiName} onChange={e => setAiName(e.target.value)} placeholder="הערכה שלי..." />
                </div>
                <Button onClick={handleAiGenerate} className="w-full gap-2">
                  <Sparkles className="h-4 w-4" />
                  צור ערכה
                </Button>
                {aiPreview && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">תצוגה מקדימה</Label>
                    <ThemeLivePreview colors={aiPreview.colors} style={aiPreview.style || DEFAULT_STYLE} name={aiPreview.nameHe} variant="light" />
                    <Button onClick={handleAiSave} className="w-full">שמור והפעל ערכה זו</Button>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {/* Import */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportFile(f);
              if (e.target) e.target.value = '';
            }}
          />
          <Button variant="outline" className="gap-2" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            ייבוא
          </Button>

          {/* Export */}
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                ייצוא
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md" dir="rtl">
              <DialogHeader>
                <DialogTitle>ייצוא ערכות נושא</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2" onClick={handleExportActive}>
                  <Download className="h-4 w-4" />
                  ייצא את הערכה הפעילה
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2" onClick={handleExportAllCustom} disabled={customThemes.length === 0}>
                  <Download className="h-4 w-4" />
                  ייצא חבילה: כל הערכות האישיות ({customThemes.length})
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Create new */}
          <Dialog open={isCreating} onOpenChange={setIsCreating}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                ערכה חדשה
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl" dir="rtl">
              <DialogHeader>
                <DialogTitle>יצירת ערכת נושא חדשה</DialogTitle>
              </DialogHeader>
              <ThemeEditor onSave={handleSave} onDuplicate={handleDuplicate} onCancel={() => setIsCreating(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Built-in themes */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground">ערכות מובנות</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {BUILT_IN_THEMES.map(theme => (
            <div key={theme.id} className="relative group">
              <ThemePreview
                theme={theme}
                isActive={activeThemeId === theme.id}
                onClick={() => { setTheme(theme.id); syncThemeToCloud(theme.id); }}
              />
              <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={e => {
                    e.stopPropagation();
                    openFloatingEditor(
                      { ...theme, nameHe: `${theme.nameHe} (עותק)`, name: `${theme.name}-copy` },
                      `עריכת "${theme.nameHe}" — שכפול כערכה חדשה`,
                      true,
                    );
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Custom themes */}
      {allThemes.filter(t => t.isCustom).length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-muted-foreground">ערכות אישיות</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {allThemes.filter(t => t.isCustom).map(theme => (
              <div key={theme.id} className="relative group">
                <ThemePreview
                  theme={theme}
                  isActive={activeThemeId === theme.id}
                  onClick={() => { setTheme(theme.id); syncThemeToCloud(theme.id); }}
                />
                <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={e => {
                      e.stopPropagation();
                      openFloatingEditor(theme, 'עריכת ערכת נושא');
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-destructive"
                    onClick={e => {
                      e.stopPropagation();
                      if (!window.confirm(`למחוק לצמיתות את ערכת הנושא "${theme.nameHe}"? פעולה זו אינה הפיכה.`)) return;
                      deleteCustomTheme(theme.id);
                      setTimeout(() => syncThemeToCloud(activeThemeId), 0);
                      toast.success('ערכת הנושא נמחקה');
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {floatingEditor?.open && (
        <FloatingThemeEditorWindow
          open={floatingEditor.open}
          title={floatingEditor.title}
          initial={floatingEditor.initial}
          isBuiltIn={floatingEditor.isBuiltIn}
          onSave={handleSave}
          onDuplicate={handleDuplicate}
          onClose={closeFloatingEditor}
          onPreview={(theme) => applyThemePreview({ colors: theme.colors, style: theme.style })}
        />
      )}
    </div>
  );
}
