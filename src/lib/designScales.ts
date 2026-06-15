import type { AppTheme, ThemeStyleOptions } from '@/hooks/useTheme';

type ToneStep = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;

type TonalScale = Record<ToneStep, string>;

const TONE_STEPS: ToneStep[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const LIGHTNESS_OFFSET_BY_STEP: Record<ToneStep, number> = {
  50: 42,
  100: 34,
  200: 26,
  300: 18,
  400: 8,
  500: 0,
  600: -8,
  700: -16,
  800: -24,
  900: -32,
  950: -40,
};

const SATURATION_OFFSET_BY_STEP: Record<ToneStep, number> = {
  50: -18,
  100: -14,
  200: -10,
  300: -6,
  400: -3,
  500: 0,
  600: 2,
  700: 4,
  800: 6,
  900: 8,
  950: 10,
};

const SHADOW_SCALE = {
  none: 'none',
  soft: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
  medium: '0 4px 6px -1px rgb(0 0 0 / 0.10), 0 2px 4px -2px rgb(0 0 0 / 0.10)',
  strong: '0 20px 25px -5px rgb(0 0 0 / 0.18), 0 8px 10px -6px rgb(0 0 0 / 0.18)',
} as const;

const DENSITY_SCALE = {
  compact: 0.85,
  comfortable: 1,
  spacious: 1.15,
} as const;

type HslParts = {
  h: number;
  s: number;
  l: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function parseHslToken(token: string): HslParts | null {
  if (!token || token === 'inherit') return null;

  const clean = token.replace(/hsl\(|\)/g, '').trim();
  const parts = clean.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;

  const h = Number(parts[0]);
  const s = Number(parts[1].replace('%', ''));
  const l = Number(parts[2].replace('%', ''));

  if ([h, s, l].some((value) => Number.isNaN(value))) return null;

  return {
    h: normalizeHue(h),
    s: clamp(s, 0, 100),
    l: clamp(l, 0, 100),
  };
}

function toHslToken(hsl: HslParts): string {
  return `${Math.round(hsl.h)} ${Math.round(hsl.s)}% ${Math.round(hsl.l)}%`;
}

function hslToHex(token: string): string {
  const parsed = parseHslToken(token);
  if (!parsed) return '#888888';

  const { h, s, l } = parsed;
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);

  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };

  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return '#88888833';
  const a = Math.round(clamp(alpha, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${normalized}${a}`;
}

function createTonalScale(baseToken: string): TonalScale {
  const parsed = parseHslToken(baseToken) || { h: 220, s: 40, l: 40 };

  const makeTone = (step: ToneStep): string =>
    toHslToken({
      h: parsed.h,
      s: clamp(parsed.s + SATURATION_OFFSET_BY_STEP[step], 8, 96),
      l: clamp(parsed.l + LIGHTNESS_OFFSET_BY_STEP[step], 4, 98),
    });

  return {
    50: makeTone(50),
    100: makeTone(100),
    200: makeTone(200),
    300: makeTone(300),
    400: makeTone(400),
    500: makeTone(500),
    600: makeTone(600),
    700: makeTone(700),
    800: makeTone(800),
    900: makeTone(900),
    950: makeTone(950),
  };
}

function buildTypographyScale(style?: ThemeStyleOptions) {
  const base = style?.fontSize ?? 14;
  const family = style?.fontFamily ?? "'Assistant', sans-serif";
  const weight = style?.fontWeight ?? 400;

  return {
    family: {
      app: family,
      sans: "'Assistant', 'Heebo', 'Rubik', sans-serif",
      serif: "'Frank Ruhl Libre', serif",
      mono: "'Cascadia Code', 'Consolas', monospace",
    },
    sizePx: {
      xs: Math.max(10, base - 3),
      sm: Math.max(11, base - 2),
      md: base,
      lg: base + 2,
      xl: base + 4,
      '2xl': base + 8,
      '3xl': base + 12,
    },
    lineHeight: {
      tight: 1.2,
      normal: 1.45,
      relaxed: 1.65,
    },
    weight: {
      thin: 300,
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
      default: weight,
    },
  };
}

function buildRadiusScale(style?: ThemeStyleOptions) {
  const base = style?.radius ?? 12;
  return {
    basePx: base,
    none: 0,
    xs: Math.max(2, Math.round(base * 0.25)),
    sm: Math.max(4, Math.round(base * 0.45)),
    md: Math.max(6, Math.round(base * 0.7)),
    lg: base,
    xl: Math.round(base * 1.25),
    full: 999,
  };
}

function buildSpacingScale(style?: ThemeStyleOptions) {
  const density = style?.density ?? 'comfortable';
  const factor = DENSITY_SCALE[density];

  return {
    unitPx: 4,
    density,
    densityFactor: factor,
    spacePx: {
      0: 0,
      1: Math.round(4 * factor),
      2: Math.round(8 * factor),
      3: Math.round(12 * factor),
      4: Math.round(16 * factor),
      5: Math.round(20 * factor),
      6: Math.round(24 * factor),
      8: Math.round(32 * factor),
      10: Math.round(40 * factor),
      12: Math.round(48 * factor),
      16: Math.round(64 * factor),
    },
  };
}

function buildGradientScale(theme: AppTheme) {
  const { colors } = theme;
  return {
    pageAtmosphere: `radial-gradient(circle at 9% 12%, hsl(${colors.accent} / 0.09) 0%, transparent 38%), radial-gradient(circle at 87% 10%, hsl(${colors.primary} / 0.08) 0%, transparent 44%), linear-gradient(180deg, hsl(${colors.background}) 0%, hsl(${colors.background}) 100%)`,
    primaryAction: `linear-gradient(135deg, hsl(${colors.primary}) 0%, hsl(${colors.ring}) 100%)`,
    accentSoft: `linear-gradient(135deg, hsl(${colors.accent} / 0.18) 0%, hsl(${colors.secondary} / 0.08) 100%)`,
    cardSurface: `linear-gradient(180deg, hsl(${colors.card}) 0%, hsl(${colors.background}) 100%)`,
    sidebarSurface: `linear-gradient(180deg, hsl(${colors.sidebarBackground}) 0%, hsl(${colors.sidebarAccent} / 0.68) 100%)`,
    alertSurface: `linear-gradient(135deg, hsl(${colors.destructive} / 0.18) 0%, hsl(${colors.card}) 100%)`,
  };
}

function buildGridScale(style?: ThemeStyleOptions) {
  const density = style?.density ?? 'comfortable';
  const densityFactor = DENSITY_SCALE[density];

  return {
    columns: {
      mobile: 4,
      tablet: 8,
      desktop: 12,
      wide: 12,
    },
    containerMaxWidthPx: {
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
      '2xl': 1400,
    },
    gutterPx: {
      mobile: Math.round(12 * densityFactor),
      tablet: Math.round(16 * densityFactor),
      desktop: Math.round(20 * densityFactor),
    },
    marginPx: {
      mobile: Math.round(16 * densityFactor),
      tablet: Math.round(24 * densityFactor),
      desktop: Math.round(32 * densityFactor),
    },
  };
}

export function buildDesignScales(theme: AppTheme) {
  const { colors, style } = theme;

  const semantic = Object.fromEntries(
    Object.entries(colors).map(([key, value]) => [key, { hsl: value, hex: hslToHex(value) }]),
  );

  const tonal = {
    neutral: createTonalScale(colors.background),
    primary: createTonalScale(colors.primary),
    accent: createTonalScale(colors.accent),
    danger: createTonalScale(colors.destructive),
    border: createTonalScale(colors.border),
    sidebar: createTonalScale(colors.sidebarPrimary),
    success: createTonalScale('145 63% 42%'),
    warning: createTonalScale('38 92% 50%'),
    info: createTonalScale(colors.ring || colors.primary),
  };

  const backgroundLightness = parseHslToken(colors.background)?.l ?? 92;
  const vsCodeType = backgroundLightness <= 40 ? 'dark' : 'light';

  return {
    meta: {
      sourceThemeId: theme.id,
      sourceThemeName: theme.nameHe || theme.name,
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      compatibleWith: ['smart-hebrew-transcriber', 'vscode'],
      vscodeType: vsCodeType,
    },
    semantic,
    tonal,
    typography: buildTypographyScale(style),
    spacing: buildSpacingScale(style),
    layoutGrid: buildGridScale(style),
    radius: buildRadiusScale(style),
    gradients: buildGradientScale(theme),
    shadow: {
      ...SHADOW_SCALE,
      default: SHADOW_SCALE[style?.shadow ?? 'soft'],
    },
    motion: {
      durationMs: {
        instant: 80,
        fast: 140,
        normal: 220,
        slow: 320,
        xslow: 480,
      },
      easing: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
        emphasized: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
    componentHints: {
      appBackground: 'background',
      cardSurface: 'card',
      sidebarSurface: 'sidebarBackground',
      strongAction: 'primary',
      subtleAction: 'secondary',
      focusRing: 'ring',
      destructiveAction: 'destructive',
      defaultIcon: 'iconColor',
    },
  };
}

export function exportDesignScalesJson(theme: AppTheme): string {
  return JSON.stringify(buildDesignScales(theme), null, 2);
}

export function buildGlobalDesignKit(theme: AppTheme) {
  const scales = buildDesignScales(theme);
  return {
    ...scales,
    meta: {
      ...scales.meta,
      scope: 'global-reusable-design-kit',
      portability: {
        recommendedFormat: ['json', 'md', 'vscode-color-theme'],
        targetStacks: ['react', 'vue', 'nextjs', 'vite', 'tailwind', 'vscode'],
      },
    },
    usageContract: {
      tokenNaming: 'semantic-first-with-tonal-fallback',
      colorSpace: 'hsl-with-hex-export',
      spacingUnit: '4px',
      radiusUnit: 'px',
      themingApproach: 'css-custom-properties',
    },
  };
}

export function exportGlobalDesignKitJson(theme: AppTheme): string {
  return JSON.stringify(buildGlobalDesignKit(theme), null, 2);
}

function formatMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const [header, ...body] = rows;
  const head = `| ${header.join(' | ')} |`;
  const sep = `| ${header.map(() => '---').join(' | ')} |`;
  const lines = body.map((row) => `| ${row.join(' | ')} |`);
  return [head, sep, ...lines].join('\n');
}

function prettyName(rawKey: string): string {
  return rawKey.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export function exportGlobalDesignKitMarkdown(theme: AppTheme): string {
  const kit = buildGlobalDesignKit(theme);
  const semanticRows = [
    ['Token', 'HSL', 'HEX'],
    ...Object.entries(kit.semantic).map(([key, value]) => [key, value.hsl, value.hex]),
  ];

  const tonalRows: string[][] = [['Palette', ...TONE_STEPS.map(String)]];
  for (const [name, scale] of Object.entries(kit.tonal)) {
    tonalRows.push([name, ...TONE_STEPS.map((step) => `${scale[step]} (${hslToHex(scale[step])})`)]);
  }

  const gradientRows = [
    ['Gradient', 'CSS'],
    ...Object.entries(kit.gradients).map(([name, value]) => [name, value]),
  ];

  const typography = kit.typography;
  const typeScaleRows = [
    ['Step', 'Size (px)'],
    ...Object.entries(typography.sizePx).map(([k, v]) => [k, String(v)]),
  ];

  const spacingRows = [
    ['Space Token', 'Pixels'],
    ...Object.entries(kit.spacing.spacePx).map(([k, v]) => [k, String(v)]),
  ];

  const radiusRows = [
    ['Radius Token', 'Pixels'],
    ...Object.entries(kit.radius).map(([k, v]) => [k, String(v)]),
  ];

  const gridRows = [
    ['Grid Property', 'Value'],
    ...Object.entries(kit.layoutGrid.columns).map(([k, v]) => [`columns.${k}`, String(v)]),
    ...Object.entries(kit.layoutGrid.containerMaxWidthPx).map(([k, v]) => [`maxWidth.${k}`, `${v}px`]),
    ...Object.entries(kit.layoutGrid.gutterPx).map(([k, v]) => [`gutter.${k}`, `${v}px`]),
    ...Object.entries(kit.layoutGrid.marginPx).map(([k, v]) => [`margin.${k}`, `${v}px`]),
  ];

  const shadowRows = [
    ['Shadow Token', 'Value'],
    ...Object.entries(kit.shadow).map(([k, v]) => [k, v]),
  ];

  const motionRows = [
    ['Motion Token', 'Value'],
    ...Object.entries(kit.motion.durationMs).map(([k, v]) => [`duration.${k}`, `${v}ms`]),
    ...Object.entries(kit.motion.easing).map(([k, v]) => [`easing.${k}`, v]),
  ];

  const families = Object.entries(typography.family)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const weights = Object.entries(typography.weight)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const componentHints = Object.entries(kit.componentHints)
    .map(([k, v]) => `- ${prettyName(k)}: ${v}`)
    .join('\n');

  return [
    `# Global Design Kit - ${kit.meta.sourceThemeName}`,
    '',
    'This file is generated from the active app theme and can be reused in any project.',
    '',
    '## Metadata',
    `- Theme ID: ${kit.meta.sourceThemeId}`,
    `- Generated At: ${kit.meta.generatedAt}`,
    `- VS Code Type: ${kit.meta.vscodeType}`,
    `- Scope: ${kit.meta.scope}`,
    '',
    '## Semantic Color Tokens',
    formatMarkdownTable(semanticRows),
    '',
    '## Tonal Scales (50..950)',
    formatMarkdownTable(tonalRows),
    '',
    '## Gradients',
    formatMarkdownTable(gradientRows),
    '',
    '## Typography',
    '### Font Families',
    families,
    '',
    '### Font Size Scale',
    formatMarkdownTable(typeScaleRows),
    '',
    '### Font Weights',
    weights,
    '',
    '### Line Heights',
    `- tight: ${typography.lineHeight.tight}`,
    `- normal: ${typography.lineHeight.normal}`,
    `- relaxed: ${typography.lineHeight.relaxed}`,
    '',
    '## Spacing Scale',
    formatMarkdownTable(spacingRows),
    '',
    '## Radius Scale',
    formatMarkdownTable(radiusRows),
    '',
    '## Layout Grid',
    formatMarkdownTable(gridRows),
    '',
    '## Shadows',
    formatMarkdownTable(shadowRows),
    '',
    '## Motion Tokens',
    formatMarkdownTable(motionRows),
    '',
    '## Component Hints',
    componentHints,
    '',
    '## Portability Rules',
    '- Keep semantic token names stable across projects.',
    '- Override only values, not token keys.',
    '- For another stack, map semantic tokens first, then tonal scales.',
    '- Use gradients as presets and keep semantic colors as source of truth.',
  ].join('\n');
}

export function buildVsCodeTheme(theme: AppTheme) {
  const { colors } = theme;
  const primary = hslToHex(colors.primary);
  const accent = hslToHex(colors.accent);
  const bg = hslToHex(colors.background);
  const fg = hslToHex(colors.foreground);
  const card = hslToHex(colors.card);
  const border = hslToHex(colors.border);
  const muted = hslToHex(colors.mutedForeground);
  const destructive = hslToHex(colors.destructive);

  const backgroundLightness = parseHslToken(colors.background)?.l ?? 92;
  const type = backgroundLightness <= 40 ? 'dark' : 'light';

  return {
    $schema: 'vscode://schemas/color-theme',
    name: `Smart Hebrew - ${theme.nameHe || theme.name} (Generated)`,
    type,
    colors: {
      'focusBorder': accent,
      'foreground': fg,
      'descriptionForeground': muted,
      'errorForeground': destructive,
      'icon.foreground': colors.iconColor && colors.iconColor !== 'inherit' ? hslToHex(colors.iconColor) : fg,

      'editor.background': bg,
      'editor.foreground': fg,
      'editorLineNumber.foreground': muted,
      'editorLineNumber.activeForeground': primary,
      'editorCursor.foreground': primary,
      'editor.selectionBackground': withAlpha(accent, 0.24),
      'editor.inactiveSelectionBackground': withAlpha(accent, 0.14),
      'editor.findMatchBackground': withAlpha(primary, 0.32),
      'editor.findMatchBorder': primary,
      'editor.wordHighlightBackground': withAlpha(accent, 0.16),
      'editorIndentGuide.background1': withAlpha(border, 0.35),
      'editorIndentGuide.activeBackground1': withAlpha(primary, 0.52),

      'editorWidget.background': card,
      'editorWidget.border': border,
      'peekView.border': border,
      'peekViewEditor.background': bg,
      'peekViewResult.background': card,

      'activityBar.background': hslToHex(colors.sidebarBackground),
      'activityBar.foreground': hslToHex(colors.sidebarForeground),
      'activityBar.activeBorder': hslToHex(colors.sidebarPrimary),
      'activityBarBadge.background': hslToHex(colors.sidebarPrimary),
      'activityBarBadge.foreground': hslToHex(colors.sidebarPrimaryForeground),

      'sideBar.background': hslToHex(colors.sidebarBackground),
      'sideBar.foreground': hslToHex(colors.sidebarForeground),
      'sideBar.border': hslToHex(colors.sidebarBorder),
      'sideBarSectionHeader.background': withAlpha(hslToHex(colors.sidebarAccent), 0.55),
      'sideBarSectionHeader.foreground': hslToHex(colors.sidebarAccentForeground),

      'list.activeSelectionBackground': withAlpha(hslToHex(colors.sidebarPrimary), 0.28),
      'list.activeSelectionForeground': hslToHex(colors.sidebarPrimaryForeground),
      'list.hoverBackground': withAlpha(hslToHex(colors.sidebarAccent), 0.55),

      'titleBar.activeBackground': card,
      'titleBar.activeForeground': fg,
      'titleBar.border': border,

      'statusBar.background': hslToHex(colors.primary),
      'statusBar.foreground': hslToHex(colors.primaryForeground),
      'statusBar.border': border,

      'panel.background': card,
      'panel.border': border,
      'panelTitle.activeBorder': primary,

      'button.background': primary,
      'button.foreground': hslToHex(colors.primaryForeground),
      'button.hoverBackground': withAlpha(primary, 0.85),
      'button.secondaryBackground': hslToHex(colors.secondary),
      'button.secondaryForeground': hslToHex(colors.secondaryForeground),

      'input.background': hslToHex(colors.input),
      'input.foreground': fg,
      'input.border': border,
      'input.placeholderForeground': muted,
      'inputOption.activeBorder': primary,

      'dropdown.background': card,
      'dropdown.foreground': fg,
      'dropdown.border': border,

      'terminal.background': bg,
      'terminal.foreground': fg,
      'terminal.ansiRed': destructive,
      'terminal.ansiGreen': hslToHex('145 63% 42%'),
      'terminal.ansiYellow': hslToHex('38 92% 50%'),
      'terminal.ansiBlue': primary,
      'terminal.ansiMagenta': accent,
      'terminal.ansiCyan': hslToHex(colors.ring),
      'terminal.ansiWhite': hslToHex(colors.primaryForeground),
      'terminal.ansiBrightBlack': muted,
    },
    tokenColors: [
      {
        name: 'Comments',
        scope: ['comment', 'punctuation.definition.comment'],
        settings: {
          foreground: muted,
          fontStyle: 'italic',
        },
      },
      {
        name: 'Strings',
        scope: ['string'],
        settings: {
          foreground: hslToHex(colors.accent),
        },
      },
      {
        name: 'Keywords',
        scope: ['keyword', 'storage.type'],
        settings: {
          foreground: primary,
          fontStyle: 'bold',
        },
      },
      {
        name: 'Types',
        scope: ['entity.name.type', 'support.type'],
        settings: {
          foreground: hslToHex(colors.ring),
        },
      },
      {
        name: 'Functions',
        scope: ['entity.name.function', 'support.function'],
        settings: {
          foreground: hslToHex(colors.foreground),
        },
      },
    ],
  };
}

export function exportVsCodeThemeJson(theme: AppTheme): string {
  return JSON.stringify(buildVsCodeTheme(theme), null, 2);
}
