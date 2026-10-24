/**
 * המרת טקסט עברי מנוקד לכתיב שמשקף הגייה אשכנזית-ליטאית.
 *
 * למה זה כאן ולא רק בתסריט הנפרד: כדי שההקראה באתר תישמע אשכנזית.
 * קול עברי רגיל קורא "תּוֹרָה" בהגייה ישראלית. אבל אם נכתוב לו "תוירה"
 * הוא יקרא בדיוק את מה שכתוב — ומה שייצא יישמע אשכנזי. כלומר הכתיב
 * הזה הוא הדרך לכפות הגייה על מנוע שאין בו שליטה בהגייה.
 *
 * זהו תעתיק להקראה, לא כתיב יידי תקני.
 *
 * חמשת הכללים מתארים הגייה **ליטאית** בלבד. בפולין ובהונגריה החולם
 * נשמע אחרת, ובחב"ד אחרת — אל תרחיבו את זה בלי למדוד.
 *
 * זהה ללוגיקה שב-scripts/ashkenazi_lite.py. שינוי כאן מחייב שינוי שם.
 */

const KAMATZ = 'ָ';
const PATACH = 'ַ';
const TSERE = 'ֵ';
const SEGOL = 'ֶ';
const HOLAM = 'ֹ';
const HOLAM_HASER = 'ֺ';
const HIRIK = 'ִ';
const KUBUTZ = 'ֻ';
const DAGESH = 'ּ';

/** כל סימני הניקוד והטעמים. */
const NIKUD_RANGE = /[֑-ׇ]/;

/** אותיות אהו"י — בסוף מילה הן אימות קריאה ולא עיצור. */
const MATRES = 'אהוי';

const ALEF = 'א';
const TAV = 'ת';
const VAV = 'ו';

function isHebrewLetter(ch: string): boolean {
  return ch >= ALEF && ch <= TAV;
}

export function stripNikud(text: string): string {
  return (text || '').replace(/[֑-ׇ]/g, '');
}

/** האם בטקסט יש ניקוד בכלל — ההמרה חסרת טעם בלעדיו. */
export function hasNikud(text: string): boolean {
  return NIKUD_RANGE.test(text || '');
}

/** אחוז המילים המנוקדות, לצורך אזהרה למשתמש. */
export function nikudCoverage(text: string): { voweled: number; total: number; percent: number } {
  const words = (text || '').split(/\s+/).filter((w) => /[א-ת]/.test(w));
  const voweled = words.filter((w) => NIKUD_RANGE.test(w)).length;
  const total = words.length;
  return { voweled, total, percent: total ? Math.round((voweled / total) * 100) : 0 };
}

/**
 * ממיר טקסט מנוקד לכתיב שמשקף הגייה ליטאית.
 *
 * דוגמאות מאומתות: תּוֹרָה→תוירה, שַׁבָּת→שבוס, אֱמֶת→אמעס,
 * חֹדֶשׁ→חוידעש, גְּמָרָא→גמורא, עוֹלָם→עוילום.
 */
export function toAshkenazi(text: string): string {
  if (!text) return '';
  const out: string[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (!isHebrewLetter(ch)) {
      out.push(ch);
      i += 1;
      continue;
    }

    // אוספים את האות עם כל הניקוד שאחריה
    let j = i + 1;
    let marks = '';
    while (j < text.length && NIKUD_RANGE.test(text[j])) {
      marks += text[j];
      j += 1;
    }

    // "ההברה האחרונה" לצורך כלל 5. אותיות אהו"י בסוף מילה הן אימות
    // קריאה ולא עיצור, ולכן אינן פותחות הברה חדשה: ב"תּוֹרָה" הקמץ
    // יושב על ר' וה-ה' שאחריו שותקת, אז ר' כן נחשבת ההברה האחרונה.
    let restLetters = '';
    for (let k = j; k < text.length; k += 1) {
      const c = text[k];
      if (isHebrewLetter(c)) restLetters += c;
      else if (!NIKUD_RANGE.test(c)) break;
    }
    const isLastLetter = restLetters.split('').every((c) => MATRES.includes(c));

    let letter = ch;
    let vowel = '';

    // כלל 1 — ת' רפה נשמעת ס'
    if (ch === TAV && !marks.includes(DAGESH)) letter = 'ס';

    // כשהאות עצמה היא ו', התנועה כבר מיוצגת על ידה ואסור להוסיף ו'
    // נוספת — אחרת "תּוֹרָה" יוצא "תווירוה" במקום "תוירה".
    const isVav = ch === VAV;

    if (marks.includes(KAMATZ)) {
      // כלל 2 — קמץ נשמע O, אבל כלל 5 גובר עליו בהברה האחרונה:
      // הקמץ שם נבלע לסגול. בלי זה "גְּמָרָא" יוצא "גמורוא".
      vowel = isVav || isLastLetter ? '' : VAV;
    } else if (marks.includes(TSERE)) {
      // כלל 3 — צירה נשמע EY
      vowel = isVav ? 'י' : 'יי';
    } else if (marks.includes(HOLAM) || marks.includes(HOLAM_HASER)) {
      // כלל 4 — חולם נשמע OY
      vowel = isVav ? 'י' : 'וי';
    } else if (marks.includes(PATACH)) {
      vowel = isLastLetter ? ALEF : '';
    } else if (marks.includes(SEGOL)) {
      vowel = 'ע';
    } else if (marks.includes(HIRIK)) {
      vowel = 'י';
    } else if (marks.includes(KUBUTZ)) {
      vowel = VAV;
    }

    out.push(letter + vowel);
    i = j;
  }

  // כלל 5 — ההברה האחרונה נוטה לסגול
  return out.join('').replace(/ו(?=[\s,.!?]|$)/g, 'ע');
}

export interface AshkenaziSpeechResult {
  /** הטקסט בכתיב אשכנזי, מוכן להקראה. */
  text: string;
  /** כמה מילים באמת השתנו — אם אפס, ההמרה לא עשתה כלום. */
  changedWords: number;
  totalWords: number;
  /** אזהרה להציג למשתמש, או ריק. */
  warning: string;
}

/**
 * ההמרה עם המידע שהמשתמש צריך לראות.
 *
 * האזהרה חשובה: טקסט לא מנוקד עובר דרך ההמרה בלי שינוי, והמשתמש
 * יחשוב שהוא מקבל הגייה אשכנזית כשבעצם הוא מקבל עברית רגילה.
 */
export function prepareAshkenaziSpeech(text: string): AshkenaziSpeechResult {
  const coverage = nikudCoverage(text);
  const converted = toAshkenazi(text);

  const before = stripNikud(text).split(/\s+/).filter(Boolean);
  const after = converted.split(/\s+/).filter(Boolean);
  let changedWords = 0;
  const pairs = Math.min(before.length, after.length);
  for (let k = 0; k < pairs; k += 1) {
    if (before[k] !== after[k]) changedWords += 1;
  }

  let warning = '';
  if (coverage.total === 0) {
    warning = 'אין טקסט עברי להמרה.';
  } else if (coverage.voweled === 0) {
    warning =
      'הטקסט אינו מנוקד, ולכן ההמרה להגייה אשכנזית לא יכולה לעבוד. ' +
      'ההקראה תהיה בעברית רגילה. צריך ניקוד.';
  } else if (coverage.percent < 60) {
    warning =
      `רק ${coverage.voweled} מתוך ${coverage.total} מילים מנוקדות ` +
      `(${coverage.percent} אחוז). המילים שאינן מנוקדות יוקראו בעברית רגילה.`;
  }

  return { text: converted, changedWords, totalWords: coverage.total, warning };
}
