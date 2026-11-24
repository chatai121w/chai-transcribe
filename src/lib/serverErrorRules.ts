/**
 * מתי שגיאה ביומן באמת מעידה על שרת התמלול.
 *
 * הכלל הקודם תפס כל שגיאה שבהודעתה המילה "server" או "connection".
 * זה רחב מדי: שגיאה בשמירה לענן, בטעינת רכיב או בכל מקום אחר שבו
 * מופיעה המילה הזאת הייתה מרימה התראה "שרת התמלול אינו מגיב" —
 * ושולחת לחפש במקום הלא נכון.
 */

/** המקורות ביומן ששייכים לשרת התמלול המקומי. */
const SERVER_SOURCES = new Set([
  "CUDA",
  "CUDA Server",
  "CUDA-SSE",
  "LocalServer",
  "ConversionRouter",
]);

/**
 * ביטויים שמעידים על כשל בדרך אל השרת, גם כשהמקור אינו מסומן.
 * כל אחד מהם נצפה ביומן אמיתי.
 */
const SERVER_FAILURE_PHRASES = [
  "whisper server unavailable",
  "transcribestream error",
  "econnrefused",
  "failed to fetch",
  "server health check failed",
  "שרת התמלול",
];

export function isTranscriptionServerError(source: string, message: string): boolean {
  if (SERVER_SOURCES.has(source)) return true;
  const text = (message || "").toLowerCase();
  return SERVER_FAILURE_PHRASES.some((phrase) => text.includes(phrase));
}
