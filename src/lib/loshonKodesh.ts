/**
 * Loshon Kodesh (לשון הקודש) — Ashkenazi pronunciation transcription support.
 *
 * Stores rules locally (localStorage) AND syncs to cloud via `lk_rules` JSONB
 * column on `user_preferences` (see useLoshonKodeshSync hook).
 *
 * Rule categories:
 *   - prompt        : Whisper initial_prompt
 *   - hotwords      : general vocabulary
 *   - names         : proper names (separate dictionary — highest priority)
 *   - replacements  : phonetic → canonical post-processing pairs
 *   - profileId     : preset profile id ('custom' | 'general' | 'chassidic' | 'litvish' | 'yerushalmi')
 *   - postProcess   : whether to apply replacements after transcription
 *   - aiPolish      : optional AI-driven final cleanup (engine, model, on/off)
 *   - suggestions   : queue of auto-learned pairs awaiting user approval
 */

import { editTranscriptCloud } from '@/utils/editTranscriptApi';

// ─────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────

export interface LkReplacement {
  from: string;
  to: string;
  wholeWord?: boolean;
}

export interface LkNameEntry {
  from: string;
  to: string;
}

export interface LkSuggestion {
  from: string;
  to: string;
  kind: 'replacement' | 'name';
  createdAt: number;
  source?: string; // e.g. 'manual-edit', 'correction-learning'
}

export type LkProfileId = 'custom' | 'general' | 'chassidic' | 'litvish' | 'yerushalmi';

export interface LkAiPolishSettings {
  enabled: boolean;
  engine: 'gemini' | 'ollama' | 'off';
  model: string;
  customPrompt?: string;
}

export interface LkRulesBundle {
  prompt: string;
  hotwords: string[];
  names: LkNameEntry[];
  replacements: LkReplacement[];
  profileId: LkProfileId;
  postProcess: boolean;
  aiPolish: LkAiPolishSettings;
  suggestions: LkSuggestion[];
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_LOSHON_KODESH_PROMPT =
  'שיעור תורה בלשון הקודש בהגייה אשכנזית. יש לתמלל בכתיב עברי תקני מלא, להתעלם מההגייה האשכנזית של החולם (אוֹי), הצירה (יי), הקמץ והת\' הרפה. ' +
  'דוגמאות לכתיב התקני שיש להעדיף: תורה, קודש, משה, אהרון, יעקב, יוסף, שלמה, שבת, יום טוב, ברוך, ברכה, מקום, מצוה, פסוק, פרשה, ' +
  'הקדוש ברוך הוא, הקב"ה, רבי, גמרא, משנה, תוספות, רש"י, רמב"ם, הלכה, סוגיא, מסכת, דף, ישיבה, בית מדרש, תפילה, אמונה, יראת שמים, חסידות, מוסר, תשובה.';

export const DEFAULT_LOSHON_KODESH_HOTWORDS: string[] = [
  'הקדוש ברוך הוא', 'הקב"ה', 'השם יתברך', 'בורא עולם', 'אדון עולם',
  'תורה', 'נביאים', 'כתובים', 'תנ"ך', 'משנה', 'גמרא', 'תלמוד', 'בבלי', 'ירושלמי',
  'תוספות', 'רש"י', 'רמב"ם', 'רמב"ן', 'רא"ש', 'שולחן ערוך', 'מחבר', 'רמ"א',
  'מסכת', 'פרק', 'דף', 'עמוד', 'משנה ברורה', 'ביאור הלכה', 'אגרות משה', 'חזון איש',
  'הלכה', 'אגדה', 'סוגיא', 'מצוה', 'ברכה', 'תפילה', 'עבודת השם', 'יראת שמים',
  'אמונה', 'חסידות', 'מוסר', 'תשובה', 'גמילות חסדים', 'אהבת ישראל', 'קדושה',
  'טהרה', 'דעת תורה', 'חינוך', 'בית מדרש', 'ישיבה', 'כולל',
  'שבת קודש', 'יום טוב', 'ראש השנה', 'יום כיפור', 'סוכות', 'חנוכה', 'פורים',
  'פסח', 'שבועות', 'תשעה באב', 'ראש חודש', 'ספירת העומר',
  'רבי', 'רבנו', 'הרב', 'אדמו"ר', 'הגאון', 'בעל שם טוב', 'הבעש"ט',
  'משה רבנו', 'אברהם אבינו', 'יצחק אבינו', 'יעקב אבינו', 'דוד המלך', 'שלמה המלך',
  'בני ישראל', 'עם ישראל', 'ארץ ישראל', 'ירושלים', 'בית המקדש',
  'מקום', 'דבר', 'ענין', 'פירוש', 'כוונה', 'משל',
  'אפשר', 'אסור', 'מותר', 'חייב', 'פטור', 'כשר', 'פסול', 'דאורייתא', 'דרבנן',
  'לכתחילה', 'בדיעבד', 'מדאורייתא', 'מדרבנן', 'הלכה למעשה',
  'אמר', 'תנא', 'תני', 'שמע מינה', 'דאמר', 'רבא', 'אביי', 'רב',
  'תורה', 'קודש', 'משה', 'אהרון', 'יעקב', 'יוסף', 'יצחק', 'אברהם', 'שלמה', 'דוד',
  'ברוך', 'ברכה', 'שבת', 'שמים', 'ארץ', 'אדם', 'עולם', 'שלום', 'אומר', 'רוצה',
  'פסוק', 'אמת', 'תפילה', 'מצוה', 'נשמה', 'בורא',
];

/** Names dictionary — separate from hotwords. Most common Ashkenazi name mispronunciations. */
export const DEFAULT_LOSHON_KODESH_NAMES: LkNameEntry[] = [
  { from: 'מוישה', to: 'משה' },
  { from: 'מויישע', to: 'משה' },
  { from: 'יענקל', to: 'יעקב' },
  { from: 'יענקיל', to: 'יעקב' },
  { from: 'יענקעלע', to: 'יעקב' },
  { from: 'יוסעל', to: 'יוסף' },
  { from: 'יוסל', to: 'יוסף' },
  { from: 'אהרן', to: 'אהרון' },
  { from: 'אהרעלע', to: 'אהרון' },
  { from: 'דוויד', to: 'דוד' },
  { from: 'דוויידל', to: 'דוד' },
  { from: 'שלוימי', to: 'שלמה' },
  { from: 'שלוימה', to: 'שלמה' },
  { from: 'שלוימקה', to: 'שלמה' },
  { from: 'מוטל', to: 'מרדכי' },
  { from: 'מוטעלע', to: 'מרדכי' },
  { from: 'שיא', to: 'ישעיהו' },
  { from: 'שייע', to: 'ישעיהו' },
  { from: 'הערשל', to: 'צבי' },
  { from: 'הערש', to: 'צבי' },
  { from: 'בערל', to: 'דב' },
  { from: 'בעריש', to: 'דב' },
  { from: 'חיים יענקל', to: 'חיים יעקב' },
  { from: 'איציק', to: 'יצחק' },
  { from: 'איציקל', to: 'יצחק' },
  { from: 'אברום', to: 'אברהם' },
  { from: 'אברמלע', to: 'אברהם' },
  { from: 'ליפא', to: 'אליפז' },
];

export const DEFAULT_LOSHON_KODESH_REPLACEMENTS: LkReplacement[] = [
  // חולם (oy → o)
  { from: 'תוירה', to: 'תורה' },
  { from: 'קוידש', to: 'קודש' },
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
];

export const DEFAULT_AI_POLISH: LkAiPolishSettings = {
  enabled: false,
  engine: 'gemini',
  model: 'gemini-2.5-flash',
  customPrompt: '',
};

// ─────────────────────────────────────────────────────────────────────
// PRESET PROFILES
// ─────────────────────────────────────────────────────────────────────

interface PresetBundle {
  prompt: string;
  hotwords: string[];
  names: LkNameEntry[];
  replacements: LkReplacement[];
}

const PRESETS: Record<Exclude<LkProfileId, 'custom'>, PresetBundle> = {
  general: {
    prompt: DEFAULT_LOSHON_KODESH_PROMPT,
    hotwords: DEFAULT_LOSHON_KODESH_HOTWORDS,
    names: DEFAULT_LOSHON_KODESH_NAMES,
    replacements: DEFAULT_LOSHON_KODESH_REPLACEMENTS,
  },
  chassidic: {
    prompt: DEFAULT_LOSHON_KODESH_PROMPT + ' שפה חסידית בעיקר, כולל ביטויי יידיש מודגשים. מעדיף כתיב מלא של ביטויים כמו: רבי, אדמו"ר, רעבע, חסיד, בעל שם טוב, מגיד, צדיק, התלהבות, דביקות, התקשרות, יחידות, פארברענגען, ניגון, מסירות נפש.',
    hotwords: [
      ...DEFAULT_LOSHON_KODESH_HOTWORDS,
      'אדמו"ר', 'הרבי', 'חסיד', 'חסידים', 'בעל שם טוב', 'הבעש"ט', 'המגיד', 'הצדיק',
      'התלהבות', 'דביקות', 'התקשרות', 'יחידות', 'פארברענגען', 'ניגון', 'ניגונים',
      'מסירות נפש', 'אהבת ישראל', 'תניא', 'ליקוטי מוהר"ן', 'נועם אלימלך',
      'בני יששכר', 'דברי חיים', 'אהבת שלום', 'דרכי משה', 'חב"ד', 'ברסלב', 'גור', 'בעלז',
      'סאטמר', 'ויז\'ניץ', 'באבוב', 'סקווירא', 'מונקאטש', 'צאנז',
    ],
    names: DEFAULT_LOSHON_KODESH_NAMES,
    replacements: DEFAULT_LOSHON_KODESH_REPLACEMENTS,
  },
  litvish: {
    prompt: DEFAULT_LOSHON_KODESH_PROMPT + ' סגנון ליטאי - דגש על למדנות, גמרא, סוגיות, ראשונים ואחרונים. מונחים נפוצים: סוגיא, מקשה, מתרץ, פשיטא, איבעית אימא, מסקנא, אבעיא, רישא, סיפא.',
    hotwords: [
      ...DEFAULT_LOSHON_KODESH_HOTWORDS,
      'סוגיא', 'סוגיות', 'מקשה', 'מתרץ', 'פשיטא', 'איבעית אימא', 'מסקנא', 'אבעיא',
      'רישא', 'סיפא', 'בריתא', 'מתניתין', 'גמרא', 'תוספות', 'מהרש"א', 'מהר"ם', 'פני יהושע',
      'קצות החושן', 'נתיבות המשפט', 'אבני מילואים', 'שב שמעתתא', 'קובץ שיעורים',
      'חידושי הגר"ח', 'אבן האזל', 'ברכת שמואל', 'אבי עזרי', 'אגרות משה',
      'פוניבז\'', 'מיר', 'סלבודקה', 'וולוז\'ין', 'בריסק', 'טלז', 'חברון',
    ],
    names: DEFAULT_LOSHON_KODESH_NAMES,
    replacements: DEFAULT_LOSHON_KODESH_REPLACEMENTS,
  },
  yerushalmi: {
    prompt: DEFAULT_LOSHON_KODESH_PROMPT + ' סגנון ירושלמי - דגש על הלכה, מוסר, מנהגי ירושלים. מעדיף כתיב תקני קלאסי.',
    hotwords: [
      ...DEFAULT_LOSHON_KODESH_HOTWORDS,
      'ירושלים', 'הכותל', 'הר הבית', 'מאה שערים', 'בית ישראל', 'גאולת ירושלים',
      'בן איש חי', 'כף החיים', 'ילקוט יוסף', 'יביע אומר', 'יחוה דעת',
      'הגאון', 'הגר"א', 'יסוד ושורש העבודה', 'משנת חסידים',
      'מנהגי ירושלים', 'נוסח ירושלים', 'עדות המזרח',
    ],
    names: DEFAULT_LOSHON_KODESH_NAMES,
    replacements: DEFAULT_LOSHON_KODESH_REPLACEMENTS,
  },
};

export const LK_PROFILE_LABELS: Record<LkProfileId, string> = {
  custom: 'מותאם אישית',
  general: 'כללי',
  chassidic: 'חסידי',
  litvish: 'ליטאי',
  yerushalmi: 'ירושלמי',
};

export function getPresetBundle(profileId: LkProfileId): PresetBundle | null {
  if (profileId === 'custom') return null;
  return PRESETS[profileId];
}

// ─────────────────────────────────────────────────────────────────────
// LOCAL STORAGE KEYS
// ─────────────────────────────────────────────────────────────────────

const LS_ENABLED = 'loshon_kodesh_mode';
const LS_PROMPT = 'lk_rules_prompt';
const LS_HOTWORDS = 'lk_rules_hotwords';
const LS_REPLACEMENTS = 'lk_rules_replacements';
const LS_POSTPROCESS = 'lk_rules_postprocess';
const LS_NAMES = 'lk_rules_names';
const LS_PROFILE = 'lk_rules_profile_id';
const LS_AI_POLISH = 'lk_rules_ai_polish';
const LS_SUGGESTIONS = 'lk_rules_suggestions';
const LS_UPDATED_AT = 'lk_rules_updated_at';

const MAX_SUGGESTIONS = 50;

// ─────────────────────────────────────────────────────────────────────
// GETTERS / SETTERS — enable + post-process
// ─────────────────────────────────────────────────────────────────────

function emit() {
  try {
    localStorage.setItem(LS_UPDATED_AT, String(Date.now()));
    window.dispatchEvent(new CustomEvent('lk-rules-changed'));
  } catch { /* ignore */ }
}

export function isLoshonKodeshEnabled(): boolean {
  try { return localStorage.getItem(LS_ENABLED) === '1'; } catch { return false; }
}
export function setLoshonKodeshEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LS_ENABLED, enabled ? '1' : '0');
    emit();
  } catch { /* ignore */ }
}

export function isLoshonKodeshPostProcessEnabled(): boolean {
  try {
    const v = localStorage.getItem(LS_POSTPROCESS);
    return v === null ? true : v === '1';
  } catch { return true; }
}
export function setLoshonKodeshPostProcessEnabled(v: boolean): void {
  try {
    localStorage.setItem(LS_POSTPROCESS, v ? '1' : '0');
    emit();
  } catch { /* ignore */ }
}

// ─── prompt ───
export function getLoshonKodeshPrompt(): string {
  try { return localStorage.getItem(LS_PROMPT) || DEFAULT_LOSHON_KODESH_PROMPT; }
  catch { return DEFAULT_LOSHON_KODESH_PROMPT; }
}
export function setLoshonKodeshPrompt(p: string): void {
  try { localStorage.setItem(LS_PROMPT, p); emit(); } catch { /* ignore */ }
}

// ─── hotwords ───
export function getLoshonKodeshHotwordsList(): string[] {
  try {
    const raw = localStorage.getItem(LS_HOTWORDS);
    if (!raw) return DEFAULT_LOSHON_KODESH_HOTWORDS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string' && x.trim()) : DEFAULT_LOSHON_KODESH_HOTWORDS;
  } catch { return DEFAULT_LOSHON_KODESH_HOTWORDS; }
}
export function setLoshonKodeshHotwordsList(list: string[]): void {
  try { localStorage.setItem(LS_HOTWORDS, JSON.stringify(list)); emit(); } catch { /* ignore */ }
}

// ─── replacements ───
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
  try { localStorage.setItem(LS_REPLACEMENTS, JSON.stringify(list)); emit(); } catch { /* ignore */ }
}

// ─── names ───
export function getLoshonKodeshNames(): LkNameEntry[] {
  try {
    const raw = localStorage.getItem(LS_NAMES);
    if (!raw) return DEFAULT_LOSHON_KODESH_NAMES;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(x => x && typeof x.from === 'string' && typeof x.to === 'string' && x.from)
      : DEFAULT_LOSHON_KODESH_NAMES;
  } catch { return DEFAULT_LOSHON_KODESH_NAMES; }
}
export function setLoshonKodeshNames(list: LkNameEntry[]): void {
  try { localStorage.setItem(LS_NAMES, JSON.stringify(list)); emit(); } catch { /* ignore */ }
}

// ─── profile ───
export function getLoshonKodeshProfileId(): LkProfileId {
  try {
    const v = localStorage.getItem(LS_PROFILE) as LkProfileId | null;
    if (v && ['custom', 'general', 'chassidic', 'litvish', 'yerushalmi'].includes(v)) return v;
  } catch { /* */ }
  return 'custom';
}

/** Switch preset. If not 'custom', overwrites prompt/hotwords/names/replacements with preset contents. */
export function setLoshonKodeshProfileId(id: LkProfileId): void {
  try {
    localStorage.setItem(LS_PROFILE, id);
    const preset = getPresetBundle(id);
    if (preset) {
      localStorage.setItem(LS_PROMPT, preset.prompt);
      localStorage.setItem(LS_HOTWORDS, JSON.stringify(preset.hotwords));
      localStorage.setItem(LS_NAMES, JSON.stringify(preset.names));
      localStorage.setItem(LS_REPLACEMENTS, JSON.stringify(preset.replacements));
    }
    emit();
  } catch { /* ignore */ }
}

// ─── AI polish ───
export function getLkAiPolishSettings(): LkAiPolishSettings {
  try {
    const raw = localStorage.getItem(LS_AI_POLISH);
    if (!raw) return DEFAULT_AI_POLISH;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_AI_POLISH, ...parsed };
  } catch { return DEFAULT_AI_POLISH; }
}
export function setLkAiPolishSettings(s: LkAiPolishSettings): void {
  try { localStorage.setItem(LS_AI_POLISH, JSON.stringify(s)); emit(); } catch { /* ignore */ }
}

// ─── suggestions ───
export function getLkSuggestions(): LkSuggestion[] {
  try {
    const raw = localStorage.getItem(LS_SUGGESTIONS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveLkSuggestions(list: LkSuggestion[]): void {
  try { localStorage.setItem(LS_SUGGESTIONS, JSON.stringify(list.slice(0, MAX_SUGGESTIONS))); emit(); } catch { /* */ }
}

/**
 * Suggest a new replacement learned from a manual edit.
 * Deduped against existing replacements/names + already-queued suggestions.
 */
export function addLkSuggestion(from: string, to: string, opts?: { kind?: 'replacement' | 'name'; source?: string }): void {
  const f = (from || '').trim();
  const t = (to || '').trim();
  if (!f || !t || f === t) return;
  if (f.length < 2 || t.length < 2) return;

  // Skip if already a known replacement / name
  const existingReplacements = getLoshonKodeshReplacements();
  if (existingReplacements.some(r => r.from === f && r.to === t)) return;
  const existingNames = getLoshonKodeshNames();
  if (existingNames.some(n => n.from === f && n.to === t)) return;

  const queue = getLkSuggestions();
  if (queue.some(s => s.from === f && s.to === t)) return;

  // Heuristic: only Hebrew tokens (no spaces typically)
  const hebrewOnly = /^[\u0590-\u05FF\u200f\u200e"'\-\s]+$/.test(f) && /^[\u0590-\u05FF\u200f\u200e"'\-\s]+$/.test(t);
  if (!hebrewOnly) return;

  // Heuristic: name detection — short, capitalized-equivalent (Hebrew has no case, so use length + common name suffixes)
  const looksLikeName = opts?.kind === 'name'
    || /(לע|קל|עלע|ל|קה)$/.test(f); // diminutive yiddish suffixes

  queue.unshift({
    from: f,
    to: t,
    kind: opts?.kind ?? (looksLikeName ? 'name' : 'replacement'),
    createdAt: Date.now(),
    source: opts?.source ?? 'auto',
  });
  saveLkSuggestions(queue);
}

export function dismissLkSuggestion(from: string, to: string): void {
  saveLkSuggestions(getLkSuggestions().filter(s => !(s.from === from && s.to === to)));
}

export function acceptLkSuggestion(s: LkSuggestion): void {
  if (s.kind === 'name') {
    const list = getLoshonKodeshNames();
    if (!list.some(n => n.from === s.from && n.to === s.to)) {
      list.unshift({ from: s.from, to: s.to });
      setLoshonKodeshNames(list);
    }
  } else {
    const list = getLoshonKodeshReplacements();
    if (!list.some(r => r.from === s.from && r.to === s.to)) {
      list.unshift({ from: s.from, to: s.to, wholeWord: true });
      setLoshonKodeshReplacements(list);
    }
  }
  dismissLkSuggestion(s.from, s.to);
  // Active profile becomes 'custom' once user-edits the rules
  if (getLoshonKodeshProfileId() !== 'custom') {
    try { localStorage.setItem(LS_PROFILE, 'custom'); } catch { /* */ }
  }
}

// ─────────────────────────────────────────────────────────────────────
// SYNC HELPERS (used by useLoshonKodeshSync)
// ─────────────────────────────────────────────────────────────────────

export function getLkRulesUpdatedAt(): number {
  try { return Number(localStorage.getItem(LS_UPDATED_AT) || 0); } catch { return 0; }
}

export function getAllLkRules(): LkRulesBundle {
  return {
    prompt: getLoshonKodeshPrompt(),
    hotwords: getLoshonKodeshHotwordsList(),
    names: getLoshonKodeshNames(),
    replacements: getLoshonKodeshReplacements(),
    profileId: getLoshonKodeshProfileId(),
    postProcess: isLoshonKodeshPostProcessEnabled(),
    aiPolish: getLkAiPolishSettings(),
    suggestions: getLkSuggestions(),
    updatedAt: getLkRulesUpdatedAt(),
  };
}

/**
 * Apply a full bundle of rules from remote. Silent — does NOT emit lk-rules-changed
 * to avoid bouncing back to the cloud during real-time updates.
 */
export function applyRemoteLkRules(bundle: Partial<LkRulesBundle>): void {
  try {
    if (typeof bundle.prompt === 'string') localStorage.setItem(LS_PROMPT, bundle.prompt);
    if (Array.isArray(bundle.hotwords)) localStorage.setItem(LS_HOTWORDS, JSON.stringify(bundle.hotwords));
    if (Array.isArray(bundle.names)) localStorage.setItem(LS_NAMES, JSON.stringify(bundle.names));
    if (Array.isArray(bundle.replacements)) localStorage.setItem(LS_REPLACEMENTS, JSON.stringify(bundle.replacements));
    if (bundle.profileId) localStorage.setItem(LS_PROFILE, bundle.profileId);
    if (typeof bundle.postProcess === 'boolean') localStorage.setItem(LS_POSTPROCESS, bundle.postProcess ? '1' : '0');
    if (bundle.aiPolish) localStorage.setItem(LS_AI_POLISH, JSON.stringify(bundle.aiPolish));
    if (Array.isArray(bundle.suggestions)) localStorage.setItem(LS_SUGGESTIONS, JSON.stringify(bundle.suggestions.slice(0, MAX_SUGGESTIONS)));
    if (typeof bundle.updatedAt === 'number') localStorage.setItem(LS_UPDATED_AT, String(bundle.updatedAt));
    // Notify UI without flipping updated_at again
    window.dispatchEvent(new CustomEvent('lk-rules-changed', { detail: { source: 'remote' } }));
  } catch { /* ignore */ }
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

// ─────────────────────────────────────────────────────────────────────
// BACKWARD COMPAT EXPORTS
// ─────────────────────────────────────────────────────────────────────

export const LOSHON_KODESH_INITIAL_PROMPT = DEFAULT_LOSHON_KODESH_PROMPT;

/**
 * Build hotwords string sent to the server. Merges user input + LK hotwords + LK name canonicals.
 */
export function buildLoshonKodeshHotwords(userHotwords?: string): string {
  const user = (userHotwords || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  const nameCanonicals = getLoshonKodeshNames().map(n => n.to);
  for (const w of [...user, ...nameCanonicals, ...getLoshonKodeshHotwordsList()]) {
    const key = (w || '').replace(/\s+/g, ' ').trim();
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

function replaceWithBoundary(text: string, from: string, to: string, wholeWord: boolean): string {
  if (!from || from === to) return text;
  const pattern = wholeWord
    ? new RegExp(`(?<![\\u0590-\\u05FFA-Za-z0-9])${escapeRegex(from)}(?![\\u0590-\\u05FFA-Za-z0-9])`, 'g')
    : new RegExp(escapeRegex(from), 'g');
  return text.replace(pattern, to);
}

/**
 * Apply phonetic→canonical replacements AND name corrections to the transcript text.
 * Names run FIRST (more specific). Both governed by the global postProcess toggle.
 */
export function applyLoshonKodeshReplacements(text: string): string {
  if (!text) return text;
  if (!isLoshonKodeshPostProcessEnabled()) return text;
  let out = text;
  // 1) Names first
  for (const n of getLoshonKodeshNames()) {
    out = replaceWithBoundary(out, n.from, n.to, true);
  }
  // 2) Generic replacements
  for (const r of getLoshonKodeshReplacements()) {
    out = replaceWithBoundary(out, r.from, r.to, r.wholeWord !== false);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// AI POLISH RUNNER
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_LK_AI_PROMPT =
  'אתה עורך מקצועי המתמחה בלשון הקודש. קיבלת טקסט שתומלל מהקלטה של שיעור תורה בהגייה אשכנזית. ' +
  'משימתך: לתקן את הכתיב לכתיב עברי תקני מלא בלבד. ' +
  'כללים מחייבים: ' +
  '1) השאר את כל המילים, הסדר והמשמעות זהים לחלוטין — אל תוסיף, אל תחסיר, אל תפרש. ' +
  '2) תקן רק שגיאות שמקורן בהגייה אשכנזית (חולם oy→o, צירה ei→e, ת\' רפה, קמץ a→o וכו\'). ' +
  '3) שמות פרטיים יוחזרו לצורתם התקנית (מוישה→משה, יענקל→יעקב, וכו\'). ' +
  '4) אל תשנה פיסוק, אל תוסיף הערות, אל תכתוב מבוא. ' +
  'החזר את הטקסט המתוקן בלבד, ללא שום תוספת.';

/**
 * Run final AI polish on transcript. Returns original text unchanged when disabled / failed.
 * Engine 'gemini' → goes through edit_transcript_proxy DB function.
 * Engine 'ollama' → calls local Ollama at localhost:11434.
 * Engine 'off'    → returns original.
 */
export async function runLkAiPolish(text: string): Promise<string> {
  const s = getLkAiPolishSettings();
  if (!s.enabled || s.engine === 'off' || !text?.trim()) return text;

  const prompt = (s.customPrompt && s.customPrompt.trim()) || DEFAULT_LK_AI_PROMPT;

  try {
    if (s.engine === 'gemini') {
      const out = await editTranscriptCloud({
        text,
        action: 'custom',
        model: s.model || 'gemini-2.5-flash',
        customPrompt: prompt,
      });
      return (out || '').trim() || text;
    }

    if (s.engine === 'ollama') {
      const res = await fetch('http://localhost:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: s.model || 'llama3',
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: text },
          ],
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
      const data = await res.json();
      const out = (data?.message?.content || data?.response || '').trim();
      return out || text;
    }
  } catch (e) {
    console.warn('[LK AI Polish] failed, returning original text:', e);
    return text;
  }

  return text;
}
