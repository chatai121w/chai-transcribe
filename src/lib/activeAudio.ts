/**
 * נגן אחד מתנגן בכל רגע.
 *
 * ברשימת תוצאות חיתוך יש נגן לכל קטע, ועוד נגן צף. בלי תיאום ביניהם
 * אפשר להפעיל כמה בבת אחת, והתוצאה היא בלגן: שני קטעים מתנגנים יחד
 * ואי אפשר להקשיב לאף אחד מהם.
 *
 * הפתרון הוא רישום אחד משותף: מי שמתחיל לנגן מודיע כאן, וכל השאר
 * מקבלים הודעה לעצור.
 */

type StopHandler = () => void;

const handlers = new Map<string, StopHandler>();
let current: string | null = null;

/**
 * רושם נגן. מחזיר פונקציה שמסירה אותו — חשוב לקרוא לה כשהנגן נעלם
 * מהמסך, אחרת הרישום מחזיק אותו בזיכרון לנצח.
 */
export function registerPlayer(id: string, stop: StopHandler): () => void {
  handlers.set(id, stop);
  return () => {
    handlers.delete(id);
    if (current === id) current = null;
  };
}

/**
 * מכריז שהנגן הזה מתחיל לנגן, ועוצר את כל השאר.
 *
 * העצירה נעשית לפני העדכון של מי מתנגן, כדי שנגן שעוצר את עצמו
 * בתגובה לא ימחק את מי שבדיוק התחיל.
 */
export function claimPlayback(id: string): void {
  for (const [otherId, stop] of handlers) {
    if (otherId === id) continue;
    try {
      stop();
    } catch {
      // נגן שנכשל בעצירה אינו אמור למנוע משאר הנגנים לעצור
    }
  }
  current = id;
}

/** מודיע שהנגן הזה הפסיק מיוזמתו. */
export function releasePlayback(id: string): void {
  if (current === id) current = null;
}

/** מי מתנגן כרגע, אם בכלל. */
export function playingNow(): string | null {
  return current;
}

/** עוצר הכול. שימושי כשסוגרים את כל האזור. */
export function stopAll(): void {
  for (const stop of handlers.values()) {
    try { stop(); } catch { /* ראה למעלה */ }
  }
  current = null;
}

/** לבדיקות בלבד: מאפס את הרישום. */
export function resetPlayers(): void {
  handlers.clear();
  current = null;
}

/** לבדיקות בלבד: כמה נגנים רשומים. */
export function registeredCount(): number {
  return handlers.size;
}
