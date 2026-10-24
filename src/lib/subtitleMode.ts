/**
 * איך הכתוביות נכנסות לקובץ הווידאו.
 *
 * ההבחנה הזאת אינה טכנית אלא מעשית, והיא תפסה אותנו בבדיקה: קובץ
 * עם מסלול כתוביות **אינו מציג אותן מעצמו**. צריך להדליק אותן בנגן,
 * והרבה נגנים פשוטים בכלל לא מציגים כפתור כזה. המשתמש פותח את
 * הקובץ, לא רואה כלום, וחושב שהחיבור נכשל.
 *
 * לכן יש שלוש אפשרויות ולא אחת:
 *
 *   מסלול          הכתוביות בפנים אבל כבויות. האיכות אינה נפגעת,
 *                  ואפשר כמה שפות שמתחלפות. אבל צריך להדליק.
 *
 *   מסלול דולק     כמו הקודם, אבל מסומן כברירת מחדל. נגנים שתומכים
 *                  בסימון ידליקו לבד. לא כולם תומכים.
 *
 *   צרוב           הכתוביות נכנסות לתמונה עצמה. תמיד נראות, בשום
 *                  נגן אי אפשר לכבות, ושפה אחת בלבד. הווידאו נדחס
 *                  מחדש ולכן האיכות נפגעת מעט.
 */

export type SubtitleMode = "track" | "default-track" | "burned";

export interface SubtitleModeInfo {
  id: SubtitleMode;
  label: string;
  /** מה קורה בפועל, בלי מונחים. */
  body: string;
  /** מתי לבחור בזה. */
  when: string;
  /** האם הווידאו נדחס מחדש. */
  reencodes: boolean;
  /** האם אפשר יותר משפה אחת. */
  multiLanguage: boolean;
}

export const SUBTITLE_MODES: SubtitleModeInfo[] = [
  {
    id: "default-track",
    label: "מסלול שנדלק לבד",
    body: "הכתוביות נכנסות כמסלול נפרד ומסומנות כברירת מחדל, כך שנגנים " +
          "שתומכים בזה מציגים אותן מיד.",
    when: "ברוב המקרים. האיכות אינה נפגעת ואפשר כמה שפות.",
    reencodes: false,
    multiLanguage: true,
  },
  {
    id: "burned",
    label: "צרוב בתמונה",
    body: "הכתוביות נכנסות לתמונה עצמה. נראות תמיד ובכל נגן, ואי אפשר " +
          "לכבות אותן.",
    when: "כששולחים למישהו שלא יידע להדליק כתוביות, או לרשתות חברתיות.",
    reencodes: true,
    multiLanguage: false,
  },
  {
    id: "track",
    label: "מסלול כבוי",
    body: "הכתוביות בפנים אבל כבויות. צריך להדליק אותן בנגן.",
    when: "כשרוצים שהצופה יחליט בעצמו.",
    reencodes: false,
    multiLanguage: true,
  },
];

export function subtitleModeInfo(mode: SubtitleMode): SubtitleModeInfo {
  return SUBTITLE_MODES.find((m) => m.id === mode) ?? SUBTITLE_MODES[0];
}

// ------------------------------------------------------- ברירת המחדל

const KEY = "subtitleMode.default";
const FALLBACK: SubtitleMode = "default-track";

function isMode(value: unknown): value is SubtitleMode {
  return SUBTITLE_MODES.some((m) => m.id === value);
}

/**
 * ברירת המחדל שנשמרה, או "מסלול שנדלק לבד".
 *
 * כל הקריאות עטופות: בחלון פרטי ובדפדפן שחוסם אחסון הן זורקות
 * שגיאה, וזה לא אמור להפיל את החלון. במקרה כזה פשוט חוזרים
 * לברירת המחדל הרגילה.
 */
export function getDefaultSubtitleMode(): SubtitleMode {
  try {
    const saved = window.localStorage.getItem(KEY);
    return isMode(saved) ? saved : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function setDefaultSubtitleMode(mode: SubtitleMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // אין אחסון. הבחירה תחול על הפעם הזאת בלבד.
  }
}

export function clearDefaultSubtitleMode(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // אין מה לנקות.
  }
}
