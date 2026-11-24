/**
 * תרגום שלבי התמלול להודעה בעברית, ומה שנגזר ממנה.
 *
 * למה זה חשוב: האחוזים מתחילים לזוז רק כשהשרת מתחיל להחזיר קטעי
 * טקסט. לפני כן יש העלאה, המתנה בתור, טעינת מנוע והכנת אודיו — ובכל
 * הזמן הזה הכפתור הראה "מתמלל… 0%", והמסך נראה תקוע אף שהכול התקדם.
 */

export type TranscribeStageType =
  | "uploading" | "session" | "queued" | "loading" | "preprocessing" | "info";

const STAGE_TEXT: Record<TranscribeStageType, string> = {
  uploading: "מעלה את הקובץ לשרת…",
  session: "האודיו מוכן בשרת",
  queued: "ממתין בתור…",
  loading: "טוען את מנוע התמלול…",
  preprocessing: "מכין את האודיו…",
  info: "מתחיל לתמלל…",
};

/** ההודעה שתוצג למשתמש לשלב הזה, או כלום אם השלב אינו מוכר. */
export function stageMessage(type: string, progress?: number): string | null {
  const text = STAGE_TEXT[type as TranscribeStageType];
  if (!text) return null;
  if (type === "uploading" && typeof progress === "number" && Number.isFinite(progress)) {
    return `מעלה את הקובץ לשרת… ${Math.round(progress)}%`;
  }
  return text;
}

/**
 * כמה זמן עוד נשאר, לפי הקצב עד כה.
 *
 * מתחת לאחוזים בודדים ההערכה חסרת ערך — דגימה אחת מתוך מאה — ולכן
 * מוחזר כלום במקום מספר שמשקר.
 */
export function estimateRemainingSec(
  elapsedSec: number,
  progressPercent: number,
  minPercent = 3,
): number | null {
  if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) return null;
  if (!Number.isFinite(progressPercent)) return null;
  if (progressPercent < minPercent || progressPercent >= 100) return null;
  return elapsedSec * ((100 - progressPercent) / progressPercent);
}
