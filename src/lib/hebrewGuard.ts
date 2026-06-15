/**
 * Hebrew-only output guard.
 * - Stores user setting in localStorage.
 * - Augments AI edit prompts with strict instructions to output Hebrew only.
 * - Optionally allows specific other languages (e.g. English brand names).
 * - Provides a post-validation helper.
 */

const KEY_ENABLED = 'hebrew_only_output_enabled';
const KEY_ALLOWED = 'hebrew_only_allowed_langs'; // CSV: e.g. "en,fr,custom:יידיש"

/** Allowed-language identifier. Built-in codes ('en','fr',...) or 'custom:<label>' for user-added. */
export type AllowedLang = string;

export interface AllowedLangPreset {
  value: string;
  label: string;
  /** Unicode regex range used to permit characters (excluded from "foreign" detection). */
  range?: string;
}

export const ALL_ALLOWED_LANGS: AllowedLangPreset[] = [
  { value: 'en', label: 'אנגלית (לטיני)', range: 'A-Za-z' },
  { value: 'fr', label: 'צרפתית', range: '\\u00C0-\\u00FF' },
  { value: 'ru', label: 'רוסית (קירילי)', range: '\\u0400-\\u04FF' },
  { value: 'ar', label: 'ערבית', range: '\\u0600-\\u06FF' },
  { value: 'es', label: 'ספרדית', range: '\\u00C0-\\u00FF' },
  { value: 'de', label: 'גרמנית', range: '\\u00C0-\\u00FF' },
  { value: 'yi', label: 'יידיש (אותיות עבריות)', range: '\\u0590-\\u05FF' },
  { value: 'zh', label: 'סינית', range: '\\u4E00-\\u9FFF' },
  { value: 'ja', label: 'יפנית', range: '\\u3040-\\u30FF\\u4E00-\\u9FFF' },
  { value: 'ko', label: 'קוריאנית', range: '\\uAC00-\\uD7AF' },
  { value: 'el', label: 'יוונית', range: '\\u0370-\\u03FF' },
  { value: 'hi', label: 'הינדי', range: '\\u0900-\\u097F' },
];

export function isHebrewOnlyEnabled(): boolean {
  try {
    const v = localStorage.getItem(KEY_ENABLED);
    return v === null ? false : v === 'true';
  } catch { return false; }
}

export function setHebrewOnlyEnabled(v: boolean): void {
  try {
    localStorage.setItem(KEY_ENABLED, String(v));
    window.dispatchEvent(new CustomEvent('hebrew-guard-changed'));
  } catch { /* noop */ }
}

export function getAllowedLangs(): AllowedLang[] {
  try {
    const raw = localStorage.getItem(KEY_ALLOWED);
    if (raw === null) return ['en']; // default: allow English (brands, code, URLs)
    if (!raw.trim()) return [];
    return raw.split(',').map(s => s.trim()).filter(Boolean);
  } catch { return ['en']; }
}

export function setAllowedLangs(langs: AllowedLang[]): void {
  try {
    // dedupe preserving order
    const seen = new Set<string>();
    const dedup = langs.filter(v => (seen.has(v) ? false : (seen.add(v), true)));
    localStorage.setItem(KEY_ALLOWED, dedup.join(','));
    window.dispatchEvent(new CustomEvent('hebrew-guard-changed'));
  } catch { /* noop */ }
}

export function getAllowedLangLabel(value: AllowedLang): string {
  if (value.startsWith('custom:')) return value.slice('custom:'.length);
  return ALL_ALLOWED_LANGS.find(l => l.value === value)?.label || value;
}

export function subscribeHebrewGuard(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener('hebrew-guard-changed', handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener('hebrew-guard-changed', handler);
    window.removeEventListener('storage', handler);
  };
}

/**
 * Build a strict Hebrew-only system instruction prefix to inject into prompts.
 * Returns empty string if guard disabled.
 * Skips for action='translate' (translate's purpose is other languages).
 */
export function buildHebrewGuardPrefix(action?: string): string {
  if (!isHebrewOnlyEnabled()) return '';
  if (action === 'translate') return '';
  const allowed = getAllowedLangs();
  const allowedLabels = allowed.map(getAllowedLangLabel).join(', ');
  const allowExceptionLine = allowed.length > 0
    ? `יוצא דופן: מותר לשמור מילים בודדות בשפות הבאות אם הופיעו במקור: ${allowedLabels} (כגון מותגים, שמות אנשים, מונחים טכניים, קוד, כתובות URL).`
    : 'אסור להוסיף שום מילה בשפה אחרת בכלל.';
  return [
    '🚨 CRITICAL SYSTEM RULE — DO NOT VIOLATE 🚨',
    'OUTPUT LANGUAGE: HEBREW ONLY (עברית בלבד).',
    'You MUST write the entire response in Hebrew script (Unicode block U+0590-U+05FF) only.',
    'FORBIDDEN: Chinese (中文/汉字), English words, Arabic, Russian, Polish, transliteration, romanization, emojis with text, language tags, code-switching.',
    'If you find yourself writing in any other script — STOP, DELETE, and rewrite in Hebrew.',
    'Do NOT translate the text. Do NOT add notes. Do NOT add explanations. Do NOT add prefixes/suffixes.',
    'Output ONLY the edited Hebrew text — nothing else.',
    '',
    'הוראת חובה בלתי ניתנת לעקיפה:',
    '• כתוב את כל הפלט אך ורק בעברית — אותיות עבריות בלבד.',
    '• אסור בהחלט סינית, אנגלית, ערבית, רוסית, פולנית, או כל שפה אחרת.',
    '• אל תוסיף משפטים, מילים, הסברים, סימונים, אימוג\'ים, או הערות בשפה אחרת.',
    '• אל תתרגם את הטקסט. אל תכתוב גרסה אנגלית. אל תוסיף transliteration.',
    `• ${allowExceptionLine}`,
    '• אם אתה לא בטוח — תמיד בחר עברית.',
    '• אם בטעות התחלת לכתוב בשפה אחרת — מחק והתחל מחדש בעברית.',
    '',
  ].join('\n');
}

/**
 * Returns true if `text` contains characters from a non-allowed script
 * (excluding Hebrew, digits, punctuation, whitespace, and allowed languages).
 */
export function containsForeignScript(text: string): { found: boolean; samples: string[] } {
  if (!text) return { found: false, samples: [] };
  const allowed = getAllowedLangs();
  const allowedRanges: string[] = [];
  for (const v of allowed) {
    if (v.startsWith('custom:')) continue; // custom labels can't define a range
    const preset = ALL_ALLOWED_LANGS.find(l => l.value === v);
    if (preset?.range) allowedRanges.push(preset.range);
  }
  // Hebrew block + common punctuation + digits + whitespace + allowed scripts
  const allowedClass = `\\u0590-\\u05FF\\u200E\\u200F0-9\\s\\p{P}\\p{S}${allowedRanges.join('')}`;
  const re = new RegExp(`[^${allowedClass}]`, 'gu');
  const matches = text.match(re) || [];
  const samples = Array.from(new Set(matches)).slice(0, 10);
  return { found: matches.length > 0, samples };
}
