/**
 * Loshon Kodesh (לשון הקודש) — Ashkenazi pronunciation transcription support.
 *
 * All rules (prompt, hotwords, phonetic replacements) are user-editable
 * via the "כללי לשון הקודש" settings page and persisted to localStorage.
 * The exported defaults below are restored when the user hits "אפס לברירת מחדל".
 */

// ─────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_LOSHON_KODESH_PROMPT =
  'שיעור תורה בלשון הקודש בהגייה אשכנזית. יש לתמלל בכתיב עברי תקני מלא, להתעלם מההגייה האשכנזית של החולם (אוֹי), הצירה (יי), הקמץ והת\' הרפה. ' +
  'דוגמאות לכתיב התקני שיש להעדיף: תורה, קודש, משה, אהרון, יעקב, יוסף, שלמה, שבת, יום טוב, ברוך, ברכה, מקום, מצוה, פסוק, פרשה, ' +
  'הקדוש ברוך הוא, הקב"ה, רבי, גמרא, משנה, תוספות, רש"י, רמב"ם, הלכה, סוגיא, מסכת, דף, ישיבה, בית מדרש, תפילה, אמונה, יראת שמים, חסידות, מוסר, תשובה.';

export const DEFAULT_LOSHON_KODESH_HOTWORDS: string[] = [
  // Names of God / titles
  'הקדוש ברוך הוא', 'הקב"ה', 'השם יתברך', 'בורא עולם', 'אדון עולם',
  // Texts & sources
  'תורה', 'נביאים', 'כתובים', 'תנ"ך', 'משנה', 'גמרא', 'תלמוד', 'בבלי', 'ירושלמי',
  'תוספות', 'רש"י', 'רמב"ם', 'רמב"ן', 'רא"ש', 'שולחן ערוך', 'מחבר', 'רמ"א',
  'מסכת', 'פרק', 'דף', 'עמוד', 'משנה ברורה', 'ביאור הלכה', 'אגרות משה', 'חזון איש',
  // Concepts
  'הלכה', 'אגדה', 'סוגיא', 'מצוה', 'ברכה', 'תפילה', 'עבודת השם', 'יראת שמים',
  'אמונה', 'חסידות', 'מוסר', 'תשובה', 'גמילות חסדים', 'אהבת ישראל', 'קדושה',
  'טהרה', 'דעת תורה', 'חינוך', 'בית מדרש', 'ישיבה', 'כולל',
  // Time & calendar
  'שבת קודש', 'יום טוב', 'ראש השנה', 'יום כיפור', 'סוכות', 'חנוכה', 'פורים',
  'פסח', 'שבועות', 'תשעה באב', 'ראש חודש', 'ספירת העומר',
  // People
  'רבי', 'רבנו', 'הרב', 'אדמו"ר', 'הגאון', 'בעל שם טוב', 'הבעש"ט',
  'משה רבנו', 'אברהם אבינו', 'יצחק אבינו', 'יעקב אבינו', 'דוד המלך', 'שלמה המלך',
  'בני ישראל', 'עם ישראל', 'ארץ ישראל', 'ירושלים', 'בית המקדש',
  // High-frequency lesson phrases
  'מקום', 'מקומות', 'דבר', 'דברים', 'ענין', 'ענינים', 'פירוש', 'כוונה', 'משל',
  'אפשר', 'אסור', 'מותר', 'חייב', 'פטור', 'כשר', 'פסול', 'דאורייתא', 'דרבנן',
  'לכתחילה', 'בדיעבד', 'מדאורייתא', 'מדרבנן', 'הלכה למעשה',
  // Aramaic high-freq
  'אמר', 'תנא', 'תני', 'שמע מינה', 'דאמר', 'רבא', 'אביי', 'רב',
  // Standard spelling for Ashkenazi-pronounced words
  'תורה', 'קודש', 'משה', 'אהרון', 'יעקב', 'יוסף', 'יצחק', 'אברהם', 'שלמה', 'דוד',
  'ברוך', 'ברכה', 'שבת', 'שמים', 'ארץ', 'אדם', 'עולם', 'שלום', 'אומר', 'רוצה',
  'פסוק', 'מקום', 'דבר', 'אמת', 'תפילה', 'מצוה', 'נשמה', 'בורא',
];

/** Phonetic → canonical replacements applied as post-processing on the transcript text. */
export interface LkReplacement {
  from: string;
  to: string;
  /** When true, match only whole-word occurrences. Default: true. */
  wholeWord?: boolean;
}

export const DEFAULT_LOSHON_KODESH_REPLACEMENTS: LkReplacement[] = [
  // חולם (oy → o)
  { from: 'תוירה', to: 'תורה' },
  { from: 'קוידש', to: 'קודש' },
  { from: 'מוישה', to: 'משה' },
  { from: 'אוימר', to: 'אומר' },
  { from: 'רויצה', to: 'רוצה' },
  { from: 'שוילם', to: 'שלום' },
  { from: 'בוריך', to: 'ברוך' },
  { from: 'דויד', to: 'דוד' },
  { from: 'יויסף', to: 'יוסף' },
  { from: 'יויניק', to: 'יונק' },
  // צירה (ei → e)
  { from: 'בייס', to: 'בית' },
  { from: 'מייר', to: 'מאיר' },
  // ת' רפה
  { from: 'שאבס', to: 'שבת' },
  { from: 'שאבעס', to: 'שבת' },
  { from: 'גיבעס', to: 'גיבת' },
  // קמץ (a → o)
  { from: 'דווקא', to: 'דווקא' }, // identity (placeholder)
];

// ─────────────────────────────────────────────────────────────────────
// LOCAL STORAGE KEYS
// ─────────────────────────────────────────────────────────────────────

const LS_ENABLED = 'loshon_kodesh_mode';
const LS_PROMPT = 'lk_rules_prompt';
const LS_HOTWORDS = 'lk_rules_hotwords';        // JSON array of strings
const LS_REPLACEMENTS = 'lk_rules_replacements'; // JSON array of LkReplacement
const LS_POSTPROCESS = 'lk_rules_postprocess';   // '1' to apply replacements

// ─────────────────────────────────────────────────────────────────────
// GETTERS / SETTERS
// ─────────────────────────────────────────────────────────────────────

export function isLoshonKodeshEnabled(): boolean {
  try { return localStorage.getItem(LS_ENABLED) === '1'; } catch { return false; }
}
export function setLoshonKodeshEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LS_ENABLED, enabled ? '1' : '0');
    window.dispatchEvent(new CustomEvent('lk-rules-changed'));
  } catch { /* ignore */ }
}

export function getLoshonKodeshPrompt(): string {
  try { return localStorage.getItem(LS_PROMPT) || DEFAULT_LOSHON_KODESH_PROMPT; }
  catch { return DEFAULT_LOSHON_KODESH_PROMPT; }
}
export function setLoshonKodeshPrompt(p: string): void {
  try {
    localStorage.setItem(LS_PROMPT, p);
    window.dispatchEvent(new CustomEvent('lk-rules-changed'));
  } catch { /* ignore */ }
}

export function getLoshonKodeshHotwordsList(): string[] {
  try {
    const raw = localStorage.getItem(LS_HOTWORDS);
    if (!raw) return DEFAULT_LOSHON_KODESH_HOTWORDS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string' && x.trim()) : DEFAULT_LOSHON_KODESH_HOTWORDS;
  } catch { return DEFAULT_LOSHON_KODESH_HOTWORDS; }
}
export function setLoshonKodeshHotwordsList(list: string[]): void {
  try {
    localStorage.setItem(LS_HOTWORDS, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('lk-rules-changed'));
  } catch { /* ignore */ }
}

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
  try {
    localStorage.setItem(LS_REPLACEMENTS, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('lk-rules-changed'));
  } catch { /* ignore */ }
}

export function isLoshonKodeshPostProcessEnabled(): boolean {
  try {
    const v = localStorage.getItem(LS_POSTPROCESS);
    return v === null ? true : v === '1'; // default ON
  } catch { return true; }
}
export function setLoshonKodeshPostProcessEnabled(v: boolean): void {
  try {
    localStorage.setItem(LS_POSTPROCESS, v ? '1' : '0');
    window.dispatchEvent(new CustomEvent('lk-rules-changed'));
  } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────
// BACKWARD-COMPAT EXPORTS (used elsewhere in the codebase)
// ─────────────────────────────────────────────────────────────────────

export const LOSHON_KODESH_INITIAL_PROMPT = DEFAULT_LOSHON_KODESH_PROMPT;

/**
 * Build the final hotwords string to send to the server. Merges user-supplied
 * hotwords with the LK list (deduped).
 */
export function buildLoshonKodeshHotwords(userHotwords?: string): string {
  const user = (userHotwords || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const w of [...user, ...getLoshonKodeshHotwordsList()]) {
    const key = w.replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(key);
  }
  return merged.join(', ');
}

// ─────────────────────────────────────────────────────────────────────
// POST-PROCESSING
// ─────────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply the configured phonetic→canonical replacements on a transcript.
 * Only runs when the user has post-processing enabled (default: on).
 */
export function applyLoshonKodeshReplacements(text: string): string {
  if (!text) return text;
  if (!isLoshonKodeshPostProcessEnabled()) return text;
  let out = text;
  for (const r of getLoshonKodeshReplacements()) {
    if (!r.from || r.from === r.to) continue;
    const whole = r.wholeWord !== false;
    // Hebrew word boundary using lookarounds (no \b for non-ASCII)
    const pattern = whole
      ? new RegExp(`(?<![\\u0590-\\u05FFA-Za-z0-9])${escapeRegex(r.from)}(?![\\u0590-\\u05FFA-Za-z0-9])`, 'g')
      : new RegExp(escapeRegex(r.from), 'g');
    out = out.replace(pattern, r.to);
  }
  return out;
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
