/**
 * קביעת ההתחלה והסוף של הקטע הנבחר.
 *
 * הרקע: כשקבעו את הסוף במקום שנמצא לפני ההתחלה, הטווח התכווץ
 * לאפס. שני הסימונים נפלו זה על זה, ובמסך נראה סימון אחד במקום
 * שניים — בלי שום הודעה שמשהו השתבש.
 *
 * מה שהיה מבלבל במיוחד: הכיוון ההפוך דווקא הסתדר מעצמו. קביעת
 * התחלה אחרי הסוף הזיזה את הסוף קדימה ונתנה טווח שמיש. רק הכיוון
 * האחד נשבר, ולכן זה נראה אקראי.
 *
 * כאן שני הכיוונים מתנהגים אותו דבר: הסימון שעומד בדרך זז, הטווח
 * לעולם אינו מתכווץ, והתוכנה אומרת מה היא הזיזה.
 */

export interface FocusRange {
  start: number;
  end: number;
}

/** הטווח הקצר ביותר שעוד אפשר לראות ולשמוע. */
export const MIN_RANGE_SEC = 0.1;

/** כמה פותחים כשסימון צריך לזוז מהדרך. */
export const NUDGE_SEC = 10;

/** איזה סימון זז מעצמו, אם בכלל. */
export type MovedMark = null | 'start' | 'end';

export interface MarkResult {
  range: FocusRange;
  moved: MovedMark;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * קובע את ההתחלה.
 *
 * אם ההתחלה החדשה נופלת אחרי הסוף, הסוף נדחף קדימה — עד סוף
 * ההקלטה, ולא מעבר לה.
 */
export function markStart(range: FocusRange, at: number, duration: number): MarkResult {
  const limit = Math.max(0, duration);
  const start = clamp(at, 0, Math.max(0, limit - MIN_RANGE_SEC));

  if (range.end >= start + MIN_RANGE_SEC) {
    return { range: { start, end: range.end }, moved: null };
  }
  const end = clamp(start + NUDGE_SEC, start + MIN_RANGE_SEC, limit || start + MIN_RANGE_SEC);
  return { range: { start, end }, moved: 'end' };
}

/**
 * קובע את הסוף.
 *
 * אם הסוף החדש נופל לפני ההתחלה, ההתחלה נסוגה אחורה — עד תחילת
 * ההקלטה, ולא לפניה. זה הכיוון שהיה שבור.
 */
export function markEnd(range: FocusRange, at: number, duration: number): MarkResult {
  const limit = Math.max(0, duration);
  const end = clamp(at, MIN_RANGE_SEC, limit || at);

  if (range.start <= end - MIN_RANGE_SEC) {
    return { range: { start: range.start, end }, moved: null };
  }
  const start = clamp(end - NUDGE_SEC, 0, end - MIN_RANGE_SEC);
  return { range: { start, end }, moved: 'start' };
}

/**
 * אורך הטווח במילים.
 *
 * בשעון של דקות ושניות, טווח של חצי שנייה מוצג כ"00:00" — והמשתמש
 * מסיק שלא נבחר כלום, אף שהסימונים במקומם. מתחת לעשר שניות מציגים
 * שבריר, ומעליהן שעון רגיל.
 */
export function formatRangeLength(seconds: number, clock: (s: number) => string): string {
  const s = Math.max(0, seconds);
  if (s >= 10) return clock(s);
  // "5.0 שניות" נראה כמו פלט של מכונה. השבריר מוצג רק כשיש אחד.
  const rounded = Math.round(s * 10) / 10;
  if (rounded === 1) return 'שנייה אחת';
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} שניות`;
}

/** מה לומר למשתמש כשסימון זז מעצמו. */
export const MOVED_NOTE: Record<Exclude<MovedMark, null>, string> = {
  end: 'הסוף היה לפני ההתחלה, אז הזזנו אותו קדימה.',
  start: 'ההתחלה הייתה אחרי הסוף, אז הזזנו אותה אחורה.',
};
