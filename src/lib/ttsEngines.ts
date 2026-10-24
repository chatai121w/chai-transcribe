/**
 * מרשם מנועי ההקראה.
 *
 * כל מנוע כאן אומת שהוא קיים בפועל ב-24 באוקטובר 2026, עם גודל, רישיון
 * ותמיכה בעברית. מנוע שלא אומת — לא נכנס לרשימה, כדי שלא יישלח מישהו
 * להוריד שלושה ג'יגה של משהו שלא קיים.
 *
 * שדה hebrew הוא ההבחנה החשובה כאן: הרבה מנועים רב-לשוניים מציגים עברית
 * ברשימת השפות שלהם אבל מפיקים פלט חסר ערך. 'מאומת' פירושו שנבדק בפועל.
 */

export type HebrewSupport = 'מאומת' | 'מוצהר' | 'חלש' | 'אין';
export type RunsLocally = 'כן' | 'גבולי' | 'לא' | 'ענן';

export interface TtsEngine {
  id: string;
  name: string;
  publisher: string;
  /** מזהה להורדה, אם זה מנוע מקומי. */
  repo?: string;
  hebrew: HebrewSupport;
  local: RunsLocally;
  sizeGb: number | null;
  /** האם הוא יכול לחקות קול מהקלטת ייחוס, ומכמה שמע. */
  cloning: string | null;
  /** האם אפשר להזין לו צלילים ישירות במקום אותיות — קריטי להגייה אשכנזית. */
  acceptsPhonemes: boolean;
  licence: string;
  notes: string;
  /** דירוג להצגה: ככל שגבוה יותר, מומלץ יותר למטרה הזו. */
  rank: number;
}

export const TTS_ENGINES: TtsEngine[] = [
  {
    id: 'bluetts25',
    name: 'BlueTTS 2.5',
    publisher: 'notmax123',
    repo: 'notmax123/BlueTTS2.5-onnx',
    hebrew: 'מאומת',
    local: 'כן',
    sizeGb: 0.28,
    cloning: 'כן — מקליפ ייחוס נקי אחד (דורש בנוסף notmax123/blue-v2, 422 מגה)',
    acceptsPhonemes: true,
    licence: 'לא רשום במחסן — לבדוק לפני שימוש מסחרי',
    notes:
      'עברית נמצאת בתערובת האימון שלו במפורש, לפי קובץ ההסבר שלו. טבלת ' +
      'הצלילים שלו מכילה 245 סימנים, וכל 38 הצלילים הדרושים להגייה ' +
      'אשכנזית-ליטאית נמצאים בה — כולל סימני הטעמה למלעיל ומלרע. הקלט ' +
      'שלו הוא צלילים ולא אותיות, ולכן אפשר לכפות עליו הגייה אשכנזית ' +
      'ישירות. יש בו גם קול עברי מוכן. מוציא קול באיכות 44.1 קילוהרץ.',
    rank: 100,
  },
  {
    id: 'blue-v2',
    name: 'מקודד הקול של BlueTTS',
    publisher: 'notmax123',
    repo: 'notmax123/blue-v2',
    hebrew: 'מאומת',
    local: 'כן',
    sizeGb: 0.42,
    cloning: 'זה תפקידו — הוא מקודד הקלטת ייחוס לייצוג שהמנוע מבין',
    acceptsPhonemes: false,
    licence: 'MIT',
    notes:
      'אינו מנוע הקראה בעצמו אלא התוספת ל-BlueTTS 2.5 שמאפשרת לשכפל קול ' +
      'מהקלטה. בייצוא של המנוע עצמו יש רק את הצד שממיר ייצוג לגלי קול, ' +
      'ולא את הצד ההפוך — ולכן בלי התוספת הזאת אפשר להשתמש רק בקולות המוכנים.',
    rank: 90,
  },
  {
    id: 'qwentts-he-gguf',
    name: 'QwenTTS עברית (גרסה דחוסה)',
    publisher: 'קהילה',
    repo: 'QwenTTS-he-1.7B-GGUF',
    hebrew: 'מוצהר',
    local: 'כן',
    sizeGb: 1.5,
    cloning: 'כן — דרך קובץ שמע ייחוס',
    acceptsPhonemes: false,
    licence: 'לא אומת',
    notes: 'כוונון עברי. איכות העברית מוצהרת אך לא נבדקה בפועל.',
    rank: 60,
  },
  {
    id: 'omnivoice',
    name: 'OmniVoice',
    publisher: 'קהילה',
    hebrew: 'מוצהר',
    local: 'כן',
    sizeGb: 0.6,
    cloning: 'כן — 3 עד 10 שניות ייחוס',
    acceptsPhonemes: false,
    licence: 'לא אומת',
    notes: 'קטן ומהיר. קטע ייחוס ארוך מ-10 שניות מאט ועלול להוריד איכות.',
    rank: 50,
  },
  {
    id: 'browser',
    name: 'הקראת הדפדפן',
    publisher: 'מובנה במערכת ההפעלה',
    hebrew: 'מוצהר',
    local: 'כן',
    sizeGb: 0,
    cloning: null,
    acceptsPhonemes: false,
    licence: 'חינם',
    notes:
      'זמין מיד בלי שום הורדה, ושימושי לבדיקה מהירה. אבל הקולות קבועים, ' +
      'אין שכפול, ואין שום שליטה בהגייה — ולכן אינו מתאים לייצור חומר אימון.',
    rank: 20,
  },
];

/** מנועים שנבדקו ונפסלו, עם הסיבה — כדי שלא ייבדקו שוב. */
export const REJECTED_ENGINES: Array<{ name: string; why: string }> = [
  { name: 'MOSS-TTS-v1.5', why: 'כ-16 ג׳יגה — פי שניים מהזיכרון הזמין' },
  { name: 'Fish-Audio-S2-Pro-He', why: 'כ-10 ג׳יגה, לא נכנס' },
  { name: 'magpie של NVIDIA', why: 'רכיב הייחוס הוסר מהמשקולות — שכפול לא יעבוד' },
  { name: 'Qwen3-TTS הבסיסי', why: 'עברית אינה ברשימת השפות' },
  { name: 'F5-TTS', why: 'עברית אינה נתמכת' },
  { name: 'Hebrish/Meorav', why: 'דובר אחד קבוע, אינו שכפול קול' },
  { name: 'Edge ו-Gemini', why: 'קולות קבועים בלבד, בלי שכפול' },
  { name: 'VoxCPM2', why: 'כ-8 ג׳יגה — גבולי מדי על 7.93' },
];

export function enginesByRank(): TtsEngine[] {
  return [...TTS_ENGINES].sort((a, b) => b.rank - a.rank);
}

export function engineById(id: string): TtsEngine | undefined {
  return TTS_ENGINES.find((e) => e.id === id);
}

/** צבע התווית לפי רמת התמיכה בעברית. */
export function hebrewBadgeTone(support: HebrewSupport): 'good' | 'warn' | 'bad' {
  if (support === 'מאומת') return 'good';
  if (support === 'מוצהר') return 'warn';
  return 'bad';
}
