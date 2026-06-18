/**
 * Loshon Kodesh (לשון הקודש) — Ashkenazi pronunciation transcription support.
 *
 * Two-layer architecture:
 *   Layer 1 — deterministic rules engine (replacements + hotwords + initial prompt)
 *   Layer 2 — optional AI fix (edge function `loshon-kodesh-ai`)
 *
 * Rules are organized in:
 *   • Categories (חולם / צירה / קמץ / ת' רפה / שמות / מונחים / כללי) — each can be toggled
 *   • Dictionaries (named groups of hotwords + replacements: שמות, הלכה, ספרים, מועדים, תפילה, ישיבתי)
 *
 * All editable via the /loshon-kodesh-rules page. Persisted to localStorage.
 */

// ─────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────

export type LkCategory = 'holam' | 'tsere' | 'kamatz' | 'tav_rafa' | 'names' | 'terms' | 'general';

export const LK_CATEGORY_LABELS: Record<LkCategory, string> = {
  holam:    'חולם (וֹי → וֹ)',
  tsere:    'צירה (ֵיי → ֵי)',
  kamatz:   'קמץ (אָ)',
  tav_rafa: "ת' רפה (ס → ת)",
  names:    'שמות פרטיים',
  terms:    'מונחים תורניים',
  general:  'כללי',
};

export interface LkReplacement {
  from: string;
  to: string;
  /** When true, match only whole-word occurrences. Default: true. */
  wholeWord?: boolean;
  /** Category — controls bulk enable/disable. Default: 'general'. */
  category?: LkCategory;
}

export interface LkDictionary {
  id: string;
  name: string;
  enabled: boolean;
  hotwords: string[];
  replacements: LkReplacement[];
  readonly?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// DEFAULTS — Prompt
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_LOSHON_KODESH_PROMPT =
  'שיעור תורה בלשון הקודש בהגייה אשכנזית. יש לתמלל בכתיב עברי תקני מלא, להתעלם מההגייה האשכנזית של החולם (אוֹי), הצירה (יי), הקמץ והת\' הרפה. ' +
  'דוגמאות לכתיב התקני שיש להעדיף: תורה, קודש, משה, אהרון, יעקב, יוסף, שלמה, שבת, יום טוב, ברוך, ברכה, מקום, מצוה, פסוק, פרשה, ' +
  'הקדוש ברוך הוא, הקב"ה, רבי, גמרא, משנה, תוספות, רש"י, רמב"ם, הלכה, סוגיא, מסכת, דף, ישיבה, בית מדרש, תפילה, אמונה, יראת שמים, חסידות, מוסר, תשובה.';

// ─────────────────────────────────────────────────────────────────────
// DEFAULTS — Base hotwords (kept for backwards-compat / non-dictionary path)
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_LOSHON_KODESH_HOTWORDS: string[] = [
  'הקדוש ברוך הוא', 'הקב"ה', 'השם יתברך', 'בורא עולם',
  'תורה', 'קודש', 'משה', 'אהרון', 'יעקב', 'יוסף', 'יצחק', 'אברהם', 'שלמה', 'דוד',
  'ברוך', 'ברכה', 'שבת', 'שמים', 'ארץ', 'אדם', 'עולם', 'שלום', 'אומר', 'רוצה',
  'פסוק', 'מקום', 'דבר', 'אמת', 'תפילה', 'מצוה', 'נשמה', 'בורא',
];

// ─────────────────────────────────────────────────────────────────────
// DEFAULTS — Categorized replacements
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_LOSHON_KODESH_REPLACEMENTS: LkReplacement[] = [
  // ── חולם (oy → o) ─────────────────────────────
  { from: 'תוירה',  to: 'תורה',  category: 'holam' },
  { from: 'קוידש',  to: 'קודש',  category: 'holam' },
  { from: 'מוישה',  to: 'משה',   category: 'holam' },
  { from: 'אוימר',  to: 'אומר',  category: 'holam' },
  { from: 'רויצה',  to: 'רוצה',  category: 'holam' },
  { from: 'שוילם',  to: 'שלום',  category: 'holam' },
  { from: 'בוריך',  to: 'ברוך',  category: 'holam' },
  { from: 'דויד',   to: 'דוד',   category: 'holam' },
  { from: 'יויסף',  to: 'יוסף',  category: 'holam' },
  { from: 'מקויים', to: 'מקום',  category: 'holam' },
  { from: 'אורץ',   to: 'ארץ',   category: 'holam' },
  { from: 'שומיים', to: 'שמים',  category: 'holam' },
  { from: 'אויהל',  to: 'אוהל',  category: 'holam' },

  // ── צירה (ei → e) ─────────────────────────────
  { from: 'בייס',   to: 'בית',   category: 'tsere' },
  { from: 'מייר',   to: 'מאיר',  category: 'tsere' },
  { from: 'אייפע',  to: 'איפה',  category: 'tsere' },
  { from: 'אייזה',  to: 'איזה',  category: 'tsere' },

  // ── ת' רפה (s → t) ────────────────────────────
  { from: 'שאבס',   to: 'שבת',   category: 'tav_rafa' },
  { from: 'שאבעס',  to: 'שבת',   category: 'tav_rafa' },
  { from: 'בייס',   to: 'בית',   category: 'tav_rafa' },
  { from: 'אמעס',   to: 'אמת',   category: 'tav_rafa' },
  { from: 'דעת',    to: 'דעת',   category: 'tav_rafa' },

  // ── שמות פרטיים (Ashkenazi nicknames) ────────
  { from: 'מויישע', to: 'משה',   category: 'names' },
  { from: 'מויישעלע', to: 'משה', category: 'names' },
  { from: 'יענקל',  to: 'יעקב',  category: 'names' },
  { from: 'יענקעלע', to: 'יעקב', category: 'names' },
  { from: 'יאסעל',  to: 'יוסף',  category: 'names' },
  { from: 'אברום',  to: 'אברהם', category: 'names' },
  { from: 'אהרל',   to: 'אהרון', category: 'names' },
  { from: 'יצחקל',  to: 'יצחק',  category: 'names' },
  { from: 'שלמהל',  to: 'שלמה',  category: 'names' },

  // ── מונחים תורניים ────────────────────────────
  { from: 'גמורא',  to: 'גמרא',  category: 'terms' },
  { from: 'הלוכע',  to: 'הלכה',  category: 'terms' },
  { from: 'משנע',   to: 'משנה',  category: 'terms' },
  { from: 'תוספעס', to: 'תוספות', category: 'terms' },
];

// ─────────────────────────────────────────────────────────────────────
// DEFAULTS — Dictionaries (named, toggleable groups)
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_DICTIONARIES: LkDictionary[] = [
  {
    id: 'names', name: 'שמות אישים', enabled: true, readonly: false,
    hotwords: [
      'משה רבנו', 'אברהם אבינו', 'יצחק אבינו', 'יעקב אבינו', 'דוד המלך', 'שלמה המלך',
      'רבי עקיבא', 'רבי מאיר', 'רבי יוחנן', 'רב', 'רבא', 'אביי', 'רש"י', 'רמב"ם', 'רמב"ן',
      'הבעש"ט', 'הגר"א', 'אדמו"ר', 'הרב', 'הגאון',
    ],
    replacements: [],
  },
  {
    id: 'halacha', name: 'הלכה', enabled: true,
    hotwords: [
      'הלכה', 'דאורייתא', 'דרבנן', 'לכתחילה', 'בדיעבד', 'מדאורייתא', 'מדרבנן',
      'אסור', 'מותר', 'חייב', 'פטור', 'כשר', 'פסול', 'מצוה', 'איסור', 'היתר',
      'שולחן ערוך', 'משנה ברורה', 'ביאור הלכה', 'אגרות משה', 'חזון איש',
    ],
    replacements: [],
  },
  {
    id: 'sources', name: 'ספרי קודש', enabled: true,
    hotwords: [
      'תורה', 'נביאים', 'כתובים', 'תנ"ך', 'משנה', 'גמרא', 'תלמוד', 'בבלי', 'ירושלמי',
      'תוספות', 'מסכת', 'פרק', 'דף', 'עמוד', 'מדרש', 'זוהר', 'תיקוני זוהר',
    ],
    replacements: [],
  },
  {
    id: 'calendar', name: 'מועדים וזמנים', enabled: true,
    hotwords: [
      'שבת קודש', 'יום טוב', 'ראש השנה', 'יום כיפור', 'סוכות', 'שמיני עצרת', 'שמחת תורה',
      'חנוכה', 'פורים', 'פסח', 'שבועות', 'תשעה באב', 'ראש חודש', 'ספירת העומר',
      'חול המועד', 'ערב שבת', 'מוצאי שבת',
    ],
    replacements: [],
  },
  {
    id: 'prayer', name: 'תפילה ועבודה', enabled: true,
    hotwords: [
      'תפילה', 'ברכה', 'שמונה עשרה', 'קריאת שמע', 'הלל', 'מוסף', 'מנחה', 'מעריב', 'שחרית',
      'עבודת השם', 'יראת שמים', 'אמונה', 'חסידות', 'מוסר', 'תשובה', 'קדושה', 'טהרה',
    ],
    replacements: [],
  },
  {
    id: 'yeshiva', name: 'אוצר ישיבתי', enabled: false,
    hotwords: [
      'ישיבה', 'כולל', 'בית מדרש', 'חברותא', 'שיעור', 'סוגיא', 'פלפול', 'חידוש',
      'ראש ישיבה', 'משגיח', 'מגיד שיעור', 'בחור', 'אברך', 'דעת תורה',
    ],
    replacements: [],
  },
];

// ─────────────────────────────────────────────────────────────────────
// DEFAULTS — Category enable map
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_CATEGORY_ENABLED: Record<LkCategory, boolean> = {
  holam: true, tsere: true, kamatz: true, tav_rafa: true,
  names: true, terms: true, general: true,
};

// ─────────────────────────────────────────────────────────────────────
// DEFAULTS — AI prompt
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_LK_AI_PROMPT =
  'אתה מומחה בעברית תקנית ובהגייה אשכנזית של לשון הקודש.\n' +
  'המשתמש דיבר בהגייה אשכנזית והטקסט תומלל באופן פונטי. תפקידך: להמיר לכתיב עברי תקני מלא, תוך הבנת ההקשר התורני.\n\n' +
  'כללי המרה:\n' +
  '1. חולם אשכנזי (oy) → וֹ. דוגמאות: תוירה→תורה, קוידש→קודש, מוישה→משה, אוימר→אומר, רויצה→רוצה.\n' +
  '2. צירה אשכנזי (ey) → ֵי. דוגמאות: בייס→בית, מייר→מאיר.\n' +
  "3. ת' רפה (s) → ת. דוגמאות: שאבעס→שבת, אמעס→אמת.\n" +
  '4. קמץ אשכנזי (o) → קמץ רגיל.\n' +
  '5. שמות פרטיים: מויישע→משה, יענקל→יעקב, יאסעל→יוסף, אברום→אברהם.\n' +
  '6. מונחים תורניים נכונים: דאורייתא, דרבנן, גמרא, פסוק, רש"י, רמב"ם, הקב"ה.\n' +
  '7. כתיב פסוקים שלם ותקני, גם אם נשמע פונטית אחרת.\n' +
  '8. שמור פיסוק טבעי, חלק לפסקאות לפי נושא.\n' +
  '9. אל תוסיף תוכן, אל תפרש, אל תקצר — רק תקן כתיב והגייה.\n\n' +
  'החזר את הטקסט המתוקן בלבד, ללא הסברים.';

export const DEFAULT_LK_AI_MODEL = 'google/gemini-2.5-flash';

// ─────────────────────────────────────────────────────────────────────
// LOCAL STORAGE KEYS
// ─────────────────────────────────────────────────────────────────────

const LS_ENABLED       = 'loshon_kodesh_mode';
const LS_PROMPT        = 'lk_rules_prompt';
const LS_HOTWORDS      = 'lk_rules_hotwords';
const LS_REPLACEMENTS  = 'lk_rules_replacements';
const LS_POSTPROCESS   = 'lk_rules_postprocess';
const LS_CATEGORIES    = 'lk_rules_categories';
const LS_DICTIONARIES  = 'lk_rules_dictionaries';
const LS_AI_ENABLED    = 'lk_rules_ai_enabled';
const LS_AI_AUTO       = 'lk_rules_ai_auto';
const LS_AI_PROMPT     = 'lk_rules_ai_prompt';
const LS_AI_MODEL      = 'lk_rules_ai_model';

// ─────────────────────────────────────────────────────────────────────
// GETTERS / SETTERS — base toggles & prompt
// ─────────────────────────────────────────────────────────────────────

const notify = () => { try { window.dispatchEvent(new CustomEvent('lk-rules-changed')); } catch { /* */ } };

export function isLoshonKodeshEnabled(): boolean {
  try { return localStorage.getItem(LS_ENABLED) === '1'; } catch { return false; }
}
export function setLoshonKodeshEnabled(v: boolean): void {
  try { localStorage.setItem(LS_ENABLED, v ? '1' : '0'); notify(); } catch { /* */ }
}

export function getLoshonKodeshPrompt(): string {
  try { return localStorage.getItem(LS_PROMPT) || DEFAULT_LOSHON_KODESH_PROMPT; }
  catch { return DEFAULT_LOSHON_KODESH_PROMPT; }
}
export function setLoshonKodeshPrompt(p: string): void {
  try { localStorage.setItem(LS_PROMPT, p); notify(); } catch { /* */ }
}

export function isLoshonKodeshPostProcessEnabled(): boolean {
  try {
    const v = localStorage.getItem(LS_POSTPROCESS);
    return v === null ? true : v === '1';
  } catch { return true; }
}
export function setLoshonKodeshPostProcessEnabled(v: boolean): void {
  try { localStorage.setItem(LS_POSTPROCESS, v ? '1' : '0'); notify(); } catch { /* */ }
}

// ─────────────────────────────────────────────────────────────────────
// Hotwords (base list)
// ─────────────────────────────────────────────────────────────────────

export function getLoshonKodeshHotwordsList(): string[] {
  try {
    const raw = localStorage.getItem(LS_HOTWORDS);
    if (!raw) return DEFAULT_LOSHON_KODESH_HOTWORDS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string' && x.trim()) : DEFAULT_LOSHON_KODESH_HOTWORDS;
  } catch { return DEFAULT_LOSHON_KODESH_HOTWORDS; }
}
export function setLoshonKodeshHotwordsList(list: string[]): void {
  try { localStorage.setItem(LS_HOTWORDS, JSON.stringify(list)); notify(); } catch { /* */ }
}

// ─────────────────────────────────────────────────────────────────────
// Replacements
// ─────────────────────────────────────────────────────────────────────

export function getLoshonKodeshReplacements(): LkReplacement[] {
  try {
    const raw = localStorage.getItem(LS_REPLACEMENTS);
    if (!raw) return DEFAULT_LOSHON_KODESH_REPLACEMENTS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(x => x && typeof x.from === 'string' && typeof x.to === 'string' && x.from)
      : DEFAULT_LOSHON_KODESH_REPLACEMENTS;
  } catch { return DEFAULT_LOSHON_KODESH_REPLACEMENTS; }
}
export function setLoshonKodeshReplacements(list: LkReplacement[]): void {
  try { localStorage.setItem(LS_REPLACEMENTS, JSON.stringify(list)); notify(); } catch { /* */ }
}

// ─────────────────────────────────────────────────────────────────────
// Category toggles
// ─────────────────────────────────────────────────────────────────────

export function getCategoryEnabled(): Record<LkCategory, boolean> {
  try {
    const raw = localStorage.getItem(LS_CATEGORIES);
    if (!raw) return { ...DEFAULT_CATEGORY_ENABLED };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CATEGORY_ENABLED, ...(parsed || {}) };
  } catch { return { ...DEFAULT_CATEGORY_ENABLED }; }
}
export function setCategoryEnabled(map: Record<LkCategory, boolean>): void {
  try { localStorage.setItem(LS_CATEGORIES, JSON.stringify(map)); notify(); } catch { /* */ }
}

// ─────────────────────────────────────────────────────────────────────
// Dictionaries
// ─────────────────────────────────────────────────────────────────────

export function getDictionaries(): LkDictionary[] {
  try {
    const raw = localStorage.getItem(LS_DICTIONARIES);
    if (!raw) return DEFAULT_DICTIONARIES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_DICTIONARIES;
    return parsed.filter(d => d && typeof d.id === 'string' && typeof d.name === 'string').map((d: any) => ({
      id: d.id, name: d.name,
      enabled: d.enabled !== false,
      hotwords: Array.isArray(d.hotwords) ? d.hotwords.filter((x: any) => typeof x === 'string') : [],
      replacements: Array.isArray(d.replacements) ? d.replacements.filter((r: any) => r && typeof r.from === 'string' && typeof r.to === 'string') : [],
      readonly: !!d.readonly,
    }));
  } catch { return DEFAULT_DICTIONARIES; }
}
export function setDictionaries(list: LkDictionary[]): void {
  try { localStorage.setItem(LS_DICTIONARIES, JSON.stringify(list)); notify(); } catch { /* */ }
}

// ─────────────────────────────────────────────────────────────────────
// AI Layer settings
// ─────────────────────────────────────────────────────────────────────

export function isLkAiEnabled(): boolean {
  try { return localStorage.getItem(LS_AI_ENABLED) === '1'; } catch { return false; }
}
export function setLkAiEnabled(v: boolean): void {
  try { localStorage.setItem(LS_AI_ENABLED, v ? '1' : '0'); notify(); } catch { /* */ }
}

export function isLkAiAuto(): boolean {
  try { return localStorage.getItem(LS_AI_AUTO) === '1'; } catch { return false; }
}
export function setLkAiAuto(v: boolean): void {
  try { localStorage.setItem(LS_AI_AUTO, v ? '1' : '0'); notify(); } catch { /* */ }
}

export function getLkAiPrompt(): string {
  try { return localStorage.getItem(LS_AI_PROMPT) || DEFAULT_LK_AI_PROMPT; }
  catch { return DEFAULT_LK_AI_PROMPT; }
}
export function setLkAiPrompt(p: string): void {
  try { localStorage.setItem(LS_AI_PROMPT, p); notify(); } catch { /* */ }
}

export function getLkAiModel(): string {
  try { return localStorage.getItem(LS_AI_MODEL) || DEFAULT_LK_AI_MODEL; }
  catch { return DEFAULT_LK_AI_MODEL; }
}
export function setLkAiModel(m: string): void {
  try { localStorage.setItem(LS_AI_MODEL, m); notify(); } catch { /* */ }
}

// ─────────────────────────────────────────────────────────────────────
// BACKWARD-COMPAT
// ─────────────────────────────────────────────────────────────────────

export const LOSHON_KODESH_INITIAL_PROMPT = DEFAULT_LOSHON_KODESH_PROMPT;

/**
 * Build hotwords string for the whisper backend. Merges:
 *  - User-supplied hotwords (from caller)
 *  - Base LK hotwords list
 *  - Hotwords from all enabled dictionaries
 */
export function buildLoshonKodeshHotwords(userHotwords?: string): string {
  const user = (userHotwords || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const dictHotwords = getDictionaries().filter(d => d.enabled).flatMap(d => d.hotwords);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const w of [...user, ...getLoshonKodeshHotwordsList(), ...dictHotwords]) {
    const key = w.replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(key);
  }
  return merged.join(', ');
}

// ─────────────────────────────────────────────────────────────────────
// POST-PROCESSING (Layer 1)
// ─────────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply ALL configured replacements (base list + enabled dictionaries),
 * respecting category toggles. Runs only when post-processing is enabled.
 */
export function applyLoshonKodeshReplacements(text: string): string {
  if (!text) return text;
  if (!isLoshonKodeshPostProcessEnabled()) return text;

  const categories = getCategoryEnabled();
  const baseReplacements = getLoshonKodeshReplacements();
  const dictReplacements = getDictionaries().filter(d => d.enabled).flatMap(d => d.replacements);
  const all = [...baseReplacements, ...dictReplacements];

  let out = text;
  for (const r of all) {
    if (!r.from || r.from === r.to) continue;
    const cat: LkCategory = (r.category as LkCategory) || 'general';
    if (categories[cat] === false) continue;

    const whole = r.wholeWord !== false;
    if (whole) {
      // Allow optional Hebrew one-letter prefix (ו ה ב ל מ ש כ) — repeated up to 2 (e.g. וה, ול, וב, וכ, ומ, שה)
      // and optional Hebrew suffix letters (ה י ו ת ם ן ך) up to 3 (covers feminine ה, plural ים/ות, possessive י/ך/ו, etc.)
      // Boundary outside still blocks mid-word false matches against unrelated Latin/digits.
      const prefix = '([והבלמשכ]{0,2})';
      const suffix = '([היותםןךנ]{0,3})';
      const pattern = new RegExp(
        `(?<![A-Za-z0-9\\u05D0-\\u05EA])${prefix}${escapeRegex(r.from)}${suffix}(?![A-Za-z0-9])`,
        'g'
      );
      out = out.replace(pattern, (_m, pre: string, suf: string) => `${pre || ''}${r.to}${suf || ''}`);
    } else {
      out = out.replace(new RegExp(escapeRegex(r.from), 'g'), r.to);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// AI Layer (Layer 2) — calls the edge function
// ─────────────────────────────────────────────────────────────────────

export async function applyLkAiFix(text: string): Promise<string> {
  if (!text || !text.trim()) return text;
  const { supabase } = await import('@/integrations/supabase/client');
  const { data, error } = await supabase.functions.invoke('loshon-kodesh-ai', {
    body: {
      text,
      prompt: getLkAiPrompt(),
      model: getLkAiModel(),
      // Pass a compact summary of the user's vocabulary so the AI knows the canonical forms
      vocabulary: Array.from(new Set([
        ...getLoshonKodeshHotwordsList(),
        ...getDictionaries().filter(d => d.enabled).flatMap(d => d.hotwords),
      ])).slice(0, 200),
    },
  });
  if (error) throw new Error(error.message || 'שגיאת AI');
  const payload = data as { text?: string; error?: string } | null;
  if (!payload || payload.error) throw new Error(payload?.error || 'AI לא החזיר תוצאה');
  try { window.dispatchEvent(new CustomEvent('ai-usage-updated')); } catch { /* */ }
  return payload.text || text;
}

export function subscribeLoshonKodeshRules(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener('lk-rules-changed', handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener('lk-rules-changed', handler);
    window.removeEventListener('storage', handler);
  };
}
