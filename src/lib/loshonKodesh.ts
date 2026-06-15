/**
 * Loshon Kodesh (לשון הקודש) — Ashkenazi pronunciation transcription support.
 *
 * Stage 2 of the hybrid plan: provide Whisper with a strong torani context
 * (initial_prompt) plus a curated hotwords list so it leans toward
 * traditional Hebrew/Aramaic spelling rather than modern Israeli phonetic
 * transcription of words like "מוקוים" → "מקום".
 *
 * Used by `useLocalServer` when `cudaOptions.loshonKodesh === true`.
 */

/**
 * Initial prompt fed to Whisper to bias the language model toward
 * traditional torani vocabulary and Ashkenazi religious context.
 * Whisper supports an `initial_prompt` (≤224 tokens). We keep it under that.
 */
/**
 * Whisper initial_prompt — biases the decoder toward standard Hebrew spelling
 * even when the speaker uses Ashkenazi pronunciation. We do NOT write the
 * phonetic forms (תוירה / קוידש / מוישה) because that would teach Whisper to
 * emit them; instead we list the canonical target spellings the model should
 * prefer, plus a short context sentence describing the speaker style.
 *
 * Mapping rules the model should apply silently:
 *  • חולם נשמע "אוֹי" → לכתוב כ-וֹ (תוֹרה ולא תוירה, קוֹדש ולא קוידש, מוֹשה ולא מוישה)
 *  • צירה נשמע "יי" → לכתוב כ-ֵי (אֵין, בֵּית, מֵאיר)
 *  • קמץ נשמע "אוֹ" אצל חלק → לכתוב לפי הכתיב התקני (דָּבָר, אָדָם)
 *  • ת' רפה נשמעת "ס" → לכתוב ת' (שבת ולא שאבס, בית ולא בייס)
 *  • שווא נע מודגש → להתעלם מההגייה ולכתוב כתיב מלא תקני
 */
export const LOSHON_KODESH_INITIAL_PROMPT =
  'שיעור תורה בלשון הקודש בהגייה אשכנזית. יש לתמלל בכתיב עברי תקני מלא, להתעלם מההגייה האשכנזית של החולם (אוֹי), הצירה (יי), הקמץ והת\' הרפה. ' +
  'דוגמאות לכתיב התקני שיש להעדיף: תורה, קודש, משה, אהרון, יעקב, יוסף, שלמה, שבת, יום טוב, ברוך, ברכה, מקום, מצוה, פסוק, פרשה, ' +
  'הקדוש ברוך הוא, הקב"ה, רבי, גמרא, משנה, תוספות, רש"י, רמב"ם, הלכה, סוגיא, מסכת, דף, ישיבה, בית מדרש, תפילה, אמונה, יראת שמים, חסידות, מוסר, תשובה.';

/**
 * Curated torani hotwords list — words/phrases very common in Torah lessons
 * and Ashkenazi pronunciation. Whisper's `hotwords` mechanism boosts the
 * probability of these tokens during decoding.
 *
 * NOTE: do NOT include words with niqqud — keep them as plain ktiv male.
 */
const TORANI_HOTWORDS = [
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
  'אמר', 'תנא', 'תני', 'שמע מינה', 'דאמר', 'רבא', 'אביי', 'רב', 'ר\' יוחנן',
  // Ashkenazi-pronounced words → standard spelling we WANT in output
  // (boosts canonical form over phonetic mis-spellings like תוירה / קוידש / מוישה / שאבס)
  'תורה', 'קודש', 'משה', 'אהרון', 'יעקב', 'יוסף', 'יצחק', 'אברהם', 'שלמה', 'דוד',
  'ברוך', 'ברכה', 'שבת', 'שמים', 'ארץ', 'אדם', 'עולם', 'שלום', 'אומר', 'רוצה',
  'פסוק', 'מקום', 'דבר', 'אמת', 'תפילה', 'מצוה', 'נשמה', 'בורא',
];

/**
 * Build the final hotwords string to send to the server.
 * Merges the torani list with any user-supplied hotwords, deduped.
 * Whisper accepts comma-separated; faster-whisper joins them into a single
 * string passed to the decoder bias.
 */
export function buildLoshonKodeshHotwords(userHotwords?: string): string {
  const user = (userHotwords || '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const w of [...user, ...TORANI_HOTWORDS]) {
    const key = w.replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(key);
  }
  return merged.join(', ');
}

/** Read the Loshon Kodesh toggle from localStorage. */
export function isLoshonKodeshEnabled(): boolean {
  try {
    return localStorage.getItem('loshon_kodesh_mode') === '1';
  } catch {
    return false;
  }
}

export function setLoshonKodeshEnabled(enabled: boolean): void {
  try {
    localStorage.setItem('loshon_kodesh_mode', enabled ? '1' : '0');
  } catch {
    /* ignore */
  }
}
