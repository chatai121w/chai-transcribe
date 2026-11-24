/**
 * מתי לבדוק שוב אם שרת התמלול חי.
 *
 * למה זה קובץ נפרד: בעלייה קרה של הדף הבדיקה הראשונה נכשלת לפעמים —
 * לא כי השרת כבוי, אלא כי הדף עדיין טוען והבקשה נחתכת בזמן הקצוב.
 * אם אחרי כישלון ממתינים דקה שלמה, המחוון מראה "שרת כבוי" באדום דקה
 * שלמה בזמן שהשרת עונה מצוין. לכן אחרי כישלון בודקים שוב מהר, ורק אם
 * זה חוזר על עצמו מתייצבים על בדיקה נדירה.
 */

/** כשהשרת עונה — אין בהילות. */
export const POLL_UP_MS = 30_000;

/** ההמתנות הקצרות אחרי כישלון, לפי הסדר. */
export const RETRY_STEPS_MS = [3_000, 8_000, 20_000] as const;

/** אחרי שהכישלון הוכח כאמיתי — בדיקה נדירה. */
export const POLL_DOWN_MS = 60_000;

/**
 * כמה להמתין עד הבדיקה הבאה.
 * @param consecutiveFailures כמה בדיקות רצופות נכשלו (0 = השרת עונה)
 */
export function nextPollDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return POLL_UP_MS;
  const step = RETRY_STEPS_MS[consecutiveFailures - 1];
  return step ?? POLL_DOWN_MS;
}

/** הבדיקה הראשונה, בזמן שהדף עוד נטען. */
export const FIRST_CHECK_TIMEOUT_MS = 10_000;
/** בדיקה שוטפת, כשהדף כבר פנוי. */
export const CHECK_TIMEOUT_MS = 4_000;

/**
 * כמה זמן לתת לבדיקה אחת לפני שחותכים אותה.
 *
 * הבדיקה הראשונה מקבלת יותר זמן: היא יוצאת בדיוק כשהדף עסוק בטעינה,
 * והמתווך עוד מחפש באיזה שער השרת יושב.
 */
export function checkTimeoutMs(checkIndex: number): number {
  return checkIndex === 0 ? FIRST_CHECK_TIMEOUT_MS : CHECK_TIMEOUT_MS;
}

/** כמה זמן לוקח עד שהמחוון מודה באמת, אם השרת באמת כבוי. */
export function msUntilSettled(): number {
  return RETRY_STEPS_MS.reduce((sum, value) => sum + value, 0);
}
