/**
 * ביטול פעולה וחזרה עליה — לסימוני החיתוך.
 *
 * למה זה לא יושב על המנגנון הכללי שכבר יש במערכת: שם הנתון הוא משתנה
 * רגיל של המסך, וכאן הסימונים חיים בתוך רכיב גלי הקול. לכן אי אפשר
 * "להחזיר ערך" — צריך לצלם את מצב הסימונים ולבנות אותו מחדש. הקובץ
 * הזה מחזיק רק את ערימת הצילומים, בלי שום קשר למסך, כדי שאפשר יהיה
 * לבדוק אותו.
 */

/** צילום של מצב הסימונים ברגע מסוים. */
export interface MarkSnapshot {
  ranges: Array<{ startSec: number; endSec: number }>;
  /** מה עושים עם המסומן: שמירה, מחיקה או פיצול. */
  mode: string;
}

export interface History<T> {
  /** מצבים קודמים, מהישן לחדש. */
  past: T[];
  /** מצבים שבוטלו וניתן לחזור אליהם. */
  future: T[];
}

/** כמה צעדים אחורה זוכרים. */
export const MAX_HISTORY = 50;

/** חלון שבו שינויים רצופים נחשבים לפעולה אחת, כמו גרירה של קצה. */
export const GROUP_WINDOW_MS = 500;

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

/**
 * רושם מצב קודם לפני שינוי.
 * כל רישום חדש מוחק את האפשרות לחזור קדימה — כמו בכל עורך.
 */
export function record<T>(history: History<T>, previous: T, max = MAX_HISTORY): History<T> {
  const past = [...history.past, previous];
  return {
    past: past.length > max ? past.slice(past.length - max) : past,
    future: [],
  };
}

/** צעד אחד אחורה. מחזיר null כשאין לאן. */
export function undo<T>(history: History<T>, current: T): { history: History<T>; snapshot: T } | null {
  if (!history.past.length) return null;
  const snapshot = history.past[history.past.length - 1];
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, current],
    },
    snapshot,
  };
}

/** צעד אחד קדימה, אחרי ביטול. מחזיר null כשאין לאן. */
export function redo<T>(history: History<T>, current: T): { history: History<T>; snapshot: T } | null {
  if (!history.future.length) return null;
  const snapshot = history.future[history.future.length - 1];
  return {
    history: {
      past: [...history.past, current],
      future: history.future.slice(0, -1),
    },
    snapshot,
  };
}

/** שני צילומים זהים — אין מה לרשום. */
export function sameSnapshot(a: MarkSnapshot, b: MarkSnapshot): boolean {
  if (a.mode !== b.mode) return false;
  if (a.ranges.length !== b.ranges.length) return false;
  return a.ranges.every((range, index) => {
    const other = b.ranges[index];
    return Math.abs(range.startSec - other.startSec) < 0.001
      && Math.abs(range.endSec - other.endSec) < 0.001;
  });
}

/**
 * האם לפתוח צעד ביטול חדש, או לצרף לצעד הקודם.
 *
 * גרירה של קצה אזור מייצרת עשרות שינויים בשנייה. בלי קיבוץ, לחיצה
 * אחת על "בטל" הייתה מזיזה את הקצה בפיקסל, והמשתמש היה צריך ללחוץ
 * חמישים פעם כדי לחזור למצב שלפני הגרירה.
 *
 * אבל הקיבוץ חייב להיות לפי *מה* השתנה ולא רק לפי הזמן: הוספה או
 * הסרה של סימון היא תמיד פעולה בפני עצמה, גם כששתיים כאלה קורות
 * בתוך שנייה. אחרת שני סימונים מהירים היו נמחקים בלחיצת ביטול אחת.
 */
export function shouldOpenNewStep(
  previous: MarkSnapshot,
  next: MarkSnapshot,
  nowMs: number,
  lastRecordMs: number,
  windowMs = GROUP_WINDOW_MS,
): boolean {
  if (previous.ranges.length !== next.ranges.length) return true;
  if (previous.mode !== next.mode) return true;
  if (lastRecordMs <= 0) return true;
  return nowMs - lastRecordMs > windowMs;
}

/** תיאור קצר של הצעד שיבוטל, להצגה למשתמש. */
export function describeSnapshot(snapshot: MarkSnapshot): string {
  const count = snapshot.ranges.length;
  if (count === 0) return "בלי סימונים";
  return count === 1 ? "סימון אחד" : `${count} סימונים`;
}
