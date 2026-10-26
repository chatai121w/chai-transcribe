/**
 * מדידת עוצמה, התאמת עוצמה, וכתיבת קובץ שמע.
 *
 * הרקע: הייצוא של קטע מעובד יצא כמעט בלי קול. שלוש סיבות הצטברו —
 * המדחס (הדוחס את הצלילים החזקים) מנמיך את הכל ואינו מחזיר את מה
 * שלקח, חוליית "הגברת העוצמה" שקיימת בהשמעה לא הייתה בשרשרת
 * הייצוא, וההקלטה עצמה חלשה במקומות. לכן לא מספיק לתקן חוליה אחת:
 * צריך גם למדוד את התוצאה ולהביא אותה לעוצמה ראויה.
 *
 * למה לא לפי השיא: בדיבור מספיק דפיקה אחת על השולחן כדי שהשיא
 * יהיה גבוה בזמן שכל הדיבור נשאר חלש. מדידה לפי העוצמה הממוצעת
 * (ריבועית) מתארת את מה שהאוזן באמת שומעת, ולכן ההתאמה נעשית
 * לפיה — עם תקרה שמונעת מהשיא להתעוות.
 */

/**
 * רוחב החיתוך של רעש החשמל, כשהוא פועל.
 *
 * מספר גבוה פירושו חיתוך צר — בדיוק סביב תדר הזמזום ולא סביב הדיבור.
 */
export const HUM_NOTCH_Q = 10;

/**
 * מכבה את חיתוך רעש החשמל.
 *
 * מלכודת שעלתה בתוכנה ביוקר: כדי לנטרל חוליית חיתוך, הערך שהיה
 * כאן הוא רוחב קטן מאוד (0.0001). זה נראה הגיוני — "רוחב קטן, השפעה
 * קטנה" — אבל זה הפוך בדיוק. המספר הזה אינו הרוחב אלא היחס ההפוך
 * אליו, ולכן 0.0001 פירושו חיתוך ברוחב של מאה אלף הרץ: כלומר חיתוך
 * של כל מה שנשמע.
 *
 * נמדד: במצב הזה עברו שלושה אחוזים מהקול בלבד. כך יצא קובץ שהוא
 * כמעט שקט, וכך גם ההשמעה עצמה הייתה חלשה בלי שאיש הבין למה.
 *
 * לכן הכיבוי הוא רוחב גדול מאוד בתדר שאינו נשמע — חיתוך שאינו נוגע
 * בשום דבר. נמדד: מאה אחוז מהקול עובר.
 */
export function applyHumNotchOff(node: BiquadFilterNode): void {
  node.frequency.value = 10;
  node.Q.value = 100;
}

/** עוצמת השיא: הדגימה החזקה ביותר, בין 0 ל-1. */
export function peakLevel(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak;
}

/** העוצמה הממוצעת (ריבועית) — קרובה למה שהאוזן תופסת כ"חזק". */
export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * עוצמת השיא "המעשית": הערך שרק אחוז קטן מהדגימות עובר אותו.
 *
 * למה לא השיא ממש: דפיקה אחת על השולחן, נקישה של עט, הקשה על
 * המקלדת — רגע אחד מתוך מיליון דגימות — קובעת את השיא, וכל חישוב
 * שנשען עליו מסיק שהקטע חזק בזמן שהדיבור כולו חלש. זה בדיוק מה
 * שגרם לקובץ לצאת בלי קול.
 *
 * החישוב הוא בספירה לתאים ולא במיון: קטע של עשר דקות הוא עשרות
 * מיליוני דגימות, ומיון שלהן היה תוקע את הדפדפן לשניות ארוכות.
 */
export function practicalPeak(samples: Float32Array, percentile = 0.995): number {
  if (samples.length === 0) return 0;
  const BINS = 2048;
  const hist = new Uint32Array(BINS);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    const bin = v >= 1 ? BINS - 1 : (v * BINS) | 0;
    hist[bin]++;
  }
  // כמה דגימות מותר להשאיר מעל הערך המוחזר
  const allowedAbove = Math.floor(samples.length * (1 - percentile));
  let above = 0;
  for (let b = BINS - 1; b >= 0; b--) {
    above += hist[b];
    if (above > allowedAbove) return (b + 1) / BINS;
  }
  return 0;
}

/**
 * עוצמת הדיבור: הממוצע של החלקים שבהם באמת מדברים.
 *
 * שתי בעיות שממוצע פשוט אינו פותר, ושתיהן קורות בכל הקלטה אמיתית:
 *
 *   שתיקות   בהקלטה עם הרבה שקט הממוצע יוצא נמוך בלי קשר לעוצמת
 *            הדיבור, והתוצאה הייתה הגברת יתר שהופכת את השקט לרעש.
 *
 *   רגע חזק  דפיקה אחת מעלה את הממוצע ומורידה את ההגברה, והדיבור
 *            נשאר חלש — בדיוק מה שקרה כאן.
 *
 * לכן ההקלטה נחתכת לקטעים קצרים, כל קטע נמדד בנפרד, והקטעים
 * השקטים יוצאים מהחשבון. זאת השיטה המקובלת במדידת עוצמה לשידור.
 */
export function speechLevel(samples: Float32Array, sampleRate = 44100): number {
  if (samples.length === 0) return 0;

  // קטעים של 50 אלפיות שנייה: ארוך מספיק כדי להכיל הברה, קצר
  // מספיק כדי שדפיקה תיפול בקטע אחד ולא תצבע את הכל.
  const block = Math.max(1, Math.floor(sampleRate * 0.05));
  const limit = practicalPeak(samples) || 1;

  const blocks: number[] = [];
  for (let start = 0; start < samples.length; start += block) {
    const end = Math.min(start + block, samples.length);
    let sum = 0;
    for (let i = start; i < end; i++) {
      // חיתוך לשיא המעשי: כך רגע חזק בודד תורם כמו דיבור רגיל
      // ולא כמו פיצוץ.
      const v = Math.min(Math.abs(samples[i]), limit);
      sum += v * v;
    }
    blocks.push(Math.sqrt(sum / (end - start)));
  }

  const loudest = Math.max(...blocks);
  if (loudest <= 0) return 0;
  // סף של עשירית מהקטע החזק ביותר — מתחתיו זה שקט או רקע.
  const gate = loudest * 0.1;
  const speaking = blocks.filter((b) => b >= gate);
  if (speaking.length === 0) return loudest;

  const mean = speaking.reduce((a, b) => a + b * b, 0) / speaking.length;
  return Math.sqrt(mean);
}

/**
 * ההגברה המרבית, פי כמה. בערך שלושים דציבל.
 *
 * גבול ולא מידה טובה: מעבר לזה כבר מגבירים בעיקר את רעש הרקע.
 * כשהגבול נתפס, התוכנה אומרת זאת למשתמש במקום להעמיד פנים
 * שהקטע הגיע לעוצמה ראויה.
 */
export const MAX_BOOST = 32;

export interface LevelTargets {
  /** העוצמה הממוצעת המבוקשת. 0.1 הוא בערך מינוס 20 דציבל — רמת דיבור נוחה. */
  targetRms?: number;
  /** התקרה. מתחת ל-1 כדי להשאיר מרווח. */
  ceiling?: number;
  /** ההגברה המרבית, פי כמה. חוסמת הגברה של הקלטה שהיא כמעט רק רעש. */
  maxBoost?: number;
  /** קצב הדגימה, לחלוקה לקטעים הקצרים. */
  sampleRate?: number;
}

/**
 * מכפיל העוצמה הדרוש.
 *
 *   1. מביאים את העוצמה הממוצעת ליעד.
 *   2. התקרה נמדדת מול השיא המעשי, לא מול השיא ממש — כדי שרגע
 *      חזק בודד לא יחסום את ההגברה של כל הקטע.
 *   3. מגבילים את ההגברה, כדי שהקלטה ריקה לא תהפוך לרעש בעוצמה מלאה.
 *
 * מה שעובר את התקרה בעקבות זה מטופל ברכות ב-applyGain, ולא נחתך.
 *
 * על שקט מוחלט מוחזר 1: אין מה להגביר, וחלוקה באפס הייתה נותנת אינסוף.
 */
export function levelGain(
  samples: Float32Array,
  { targetRms = 0.1, ceiling = 0.95, maxBoost = MAX_BOOST, sampleRate = 44100 }: LevelTargets = {},
): number {
  const rms = speechLevel(samples, sampleRate);
  if (rms <= 0) return 1;
  const peak = practicalPeak(samples);
  if (peak <= 0) return 1;

  let gain = targetRms / rms;
  gain = Math.min(gain, ceiling / peak);
  gain = Math.min(gain, maxBoost);
  // הגברה חיובית בלבד אינה נכונה כאן: חומר שמתפוצץ צריך לרדת.
  return Math.max(gain, 0.01);
}

/** נקודת הריכוך. מתחתיה הצליל עובר כמו שהוא. */
const SOFT_KNEE = 0.72;

/**
 * ריכוך במקום חיתוך.
 *
 * חיתוך ישר הופך פסגה לקו שטוח, והאוזן שומעת את זה כנקישה צורמת.
 * כאן הפסגות שמעל נקודת הריכוך נדחסות בעקומה רציפה שמתקרבת ל-1
 * ולעולם אינה עוברת אותו, כך שרגע חזק בודד אינו מתעוות ואינו
 * מונע מהקטע כולו להישמע.
 */
export function softClip(v: number): number {
  const a = Math.abs(v);
  if (a <= SOFT_KNEE) return v;
  const over = (a - SOFT_KNEE) / (1 - SOFT_KNEE);
  const shaped = SOFT_KNEE + (1 - SOFT_KNEE) * Math.tanh(over);
  return v < 0 ? -shaped : shaped;
}

/** מחזיר עותק מוגבר ומרוכך. המקור אינו משתנה. */
export function applyGain(samples: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = softClip(samples[i] * gain);
  return out;
}

/** מכפיל עוצמה בדציבלים, לתצוגה למשתמש. */
export function gainToDb(gain: number): number {
  if (gain <= 0) return -Infinity;
  return 20 * Math.log10(gain);
}

/** קובץ שמע לא דחוס. איכות מלאה, קובץ גדול. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const numChannels = 1;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** קצבי הדגימה שרכיב הדחיסה יודע לטפל בהם. */
export const MP3_SAMPLE_RATES = [
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
] as const;

export function canEncodeMp3(sampleRate: number): boolean {
  return (MP3_SAMPLE_RATES as readonly number[]).includes(sampleRate);
}

/** גודל המנה שרכיב הדחיסה מצפה לקבל. */
const MP3_FRAME = 1152;

/**
 * קובץ שמע דחוס. קטן בערך פי עשרה, ונפתח בכל מכשיר.
 *
 * רכיב הדחיסה נטען רק כשצריך אותו: הוא כבד, ורוב הכניסות לתוכנה
 * אינן מייצאות דבר. הטעינה לפי דרישה חוסכת אותו מזמן הפתיחה.
 */
export async function encodeMp3(
  samples: Float32Array,
  sampleRate: number,
  kbps = 128,
): Promise<Blob> {
  if (!canEncodeMp3(sampleRate)) {
    throw new Error(`קצב הדגימה ${sampleRate} אינו נתמך בדחיסה`);
  }

  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(1, sampleRate, kbps);

  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  const parts: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += MP3_FRAME) {
    const chunk = encoder.encodeBuffer(pcm.subarray(i, i + MP3_FRAME));
    if (chunk.length > 0) parts.push(chunk);
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail);

  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}

export type AudioFormat = 'wav' | 'mp3';

export const FORMAT_LABELS: Record<AudioFormat, { label: string; note: string }> = {
  wav: { label: 'איכות מלאה', note: 'בלי שום אובדן. הקובץ גדול.' },
  mp3: { label: 'קובץ קטן', note: 'קטן בערך פי עשרה. נפתח בכל מכשיר.' },
};
