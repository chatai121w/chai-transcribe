/**
 * האם להציג את מרכז המשימות.
 *
 * מרכז המשימות הוא כפתור צף שנמצא על המסך תמיד, בכל עמוד. מי
 * שאינו משתמש בהורדות וברקע אינו צריך אותו כלל, ואין סיבה שהוא
 * יתפוס מקום ויכסה תוכן.
 *
 * הערך נשמר בתוך שדה ההגדרות הכללי שבענן, ולכן הבחירה עוברת גם
 * למחשב אחר — הלקח ממתג אוצר המילים, שנשמר בדפדפן בלבד ולא עבר.
 *
 * יש גם עותק מקומי. הכפתור מוצג לפני שהעדפות הענן נטענות, ובלי
 * העותק הזה הוא היה מהבהב: מופיע, ואז נעלם.
 */

export const JOBS_CENTER_KEY = "jobs_center_visible";
const LOCAL_KEY = "jobsCenter.visible";

/** ברירת המחדל: מוצג. כיבוי הוא בחירה מפורשת. */
export const JOBS_CENTER_DEFAULT = true;

export function readLocalJobsCenterVisible(): boolean {
  try {
    const v = window.localStorage.getItem(LOCAL_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch { /* אין אחסון — ברירת המחדל */ }
  return JOBS_CENTER_DEFAULT;
}

export function writeLocalJobsCenterVisible(visible: boolean): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, visible ? "1" : "0");
  } catch { /* אין אחסון. הבחירה תחול על הפעם הזאת בלבד. */ }
}

/** קורא את הערך מתוך שדה ההגדרות הכללי, אם הוא שם. */
export function readCloudJobsCenterVisible(tabSettingsJson: string): boolean | null {
  try {
    const parsed = JSON.parse(tabSettingsJson || "{}");
    const v = parsed?.[JOBS_CENTER_KEY];
    return typeof v === "boolean" ? v : null;
  } catch {
    // הגדרות פגומות — מתייחסים לזה כאילו אין ערך.
    return null;
  }
}
