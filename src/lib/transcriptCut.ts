/**
 * חיתוך אודיו לפי סימון מילים בתמלול.
 *
 * הגשר בין שני דברים שכבר קיימים במערכת:
 *   • השרת מחזיר לכל מילה זמן התחלה וזמן סיום (`wordTimings`).
 *   • מנוע החיתוך עובד בטווחי זמן (`AudioRange`).
 *
 * כאן אין ממשק וכאן אין קריאות לשרת — רק חשבון טהור, כדי שאפשר יהיה
 * לבדוק הכול אוטומטית.
 *
 * למה צריך הצמדה לשקט:
 * זמני המילים של מנוע התמלול מדויקים בעשיריות שנייה בלבד. לקריאה ולקפיצה
 * בנגן זה מספיק. לחיתוך זה לא: חיתוך בדיוק בזמן שהמנוע נתן בולע לפעמים את
 * ההגייה הראשונה או משאיר זנב. לכן אחרי שמשתמש מסמן משפט, מזיזים כל קצה
 * לרגע השקט הקרוב ביותר — ורק אם באמת נמצא שם שקט.
 */

import type { AudioRange } from "./audioEditPlan";

export interface CutWord {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

/** סימני פיסוק שמסיימים משפט בעברית. */
const SENTENCE_ENDINGS = /[.!?;:׃]\s*["'”’״]?\s*$/;

/** שתיקה ארוכה מזו נחשבת סוף משפט גם בלי סימן פיסוק. */
const DEFAULT_SENTENCE_GAP_SEC = 0.6;

/** פחות מזה אינו קטע שאפשר לחתוך. */
const MIN_RANGE_SEC = 0.05;

// ── סימון מילים → טווח זמן ────────────────────────────────────────────────

/**
 * הופך סימון של מילים לטווח זמן אחד.
 * סדר האינדקסים לא משנה — סימון לאחור עובד כמו סימון קדימה.
 * מחזיר null אם הסימון ריק, מחוץ לתחום, או קצר מדי לחיתוך.
 */
export function wordsToRange(
  words: CutWord[],
  fromIndex: number,
  toIndex: number,
  options: { padSec?: number; durationSec?: number } = {},
): AudioRange | null {
  if (!words.length) return null;

  const low = Math.min(fromIndex, toIndex);
  const high = Math.max(fromIndex, toIndex);
  if (!Number.isInteger(low) || !Number.isInteger(high)) return null;
  if (high < 0 || low > words.length - 1) return null;

  const first = words[Math.max(0, low)];
  const last = words[Math.min(words.length - 1, high)];
  if (!first || !last) return null;
  if (!Number.isFinite(first.start) || !Number.isFinite(last.end)) return null;

  const pad = Math.max(0, options.padSec ?? 0);
  const upperLimit = Number.isFinite(options.durationSec as number) && (options.durationSec as number) > 0
    ? (options.durationSec as number)
    : Infinity;

  const startSec = Math.max(0, first.start - pad);
  const endSec = Math.min(upperLimit, last.end + pad);
  if (endSec - startSec < MIN_RANGE_SEC) return null;

  const text = words.slice(Math.max(0, low), Math.min(words.length, high + 1))
    .map((w) => w.word)
    .join(" ")
    .trim();

  return { startSec, endSec, label: text.length > 60 ? `${text.slice(0, 57)}…` : text };
}

// ── זיהוי משפטים ──────────────────────────────────────────────────────────

export interface SentenceSpan {
  startIndex: number;
  endIndex: number;
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * מחלק את רשימת המילים למשפטים — לפי סימן פיסוק מסיים, או לפי שתיקה ארוכה.
 * כך לחיצה אחת יכולה לסמן משפט שלם במקום מילה אחת.
 */
export function detectSentences(
  words: CutWord[],
  options: { gapSec?: number } = {},
): SentenceSpan[] {
  if (!words.length) return [];
  const gapLimit = options.gapSec ?? DEFAULT_SENTENCE_GAP_SEC;

  const spans: SentenceSpan[] = [];
  let startIndex = 0;

  const push = (from: number, to: number) => {
    const first = words[from];
    const last = words[to];
    spans.push({
      startIndex: from,
      endIndex: to,
      startSec: first.start,
      endSec: last.end,
      text: words.slice(from, to + 1).map((w) => w.word).join(" ").trim(),
    });
  };

  for (let i = 0; i < words.length; i += 1) {
    const current = words[i];
    const next = words[i + 1];
    const endsWithPunctuation = SENTENCE_ENDINGS.test(current.word);
    const longGap = next ? next.start - current.end >= gapLimit : false;

    if (!next) {
      push(startIndex, i);
      break;
    }
    if (endsWithPunctuation || longGap) {
      push(startIndex, i);
      startIndex = i + 1;
    }
  }

  return spans;
}

/** המשפט שהמילה במקום הזה שייכת אליו. */
export function sentenceAtIndex(sentences: SentenceSpan[], wordIndex: number): SentenceSpan | null {
  return sentences.find((s) => wordIndex >= s.startIndex && wordIndex <= s.endIndex) ?? null;
}

// ── מעטפת העוצמה של האודיו ────────────────────────────────────────────────

export interface QuietEnvelope {
  /** עוצמה ממוצעת בכל חלון זמן, בסדר כרונולוגי. */
  values: Float32Array;
  /** כמה חלונות יש בשנייה אחת. */
  rate: number;
}

/**
 * בונה מעטפת עוצמה מדגימות האודיו: לכל חלון קצר, העוצמה הממוצעת בו.
 * זה מה שמאפשר לזהות איפה יש שקט בלי לטעון ספרייה נוספת.
 */
export function buildQuietEnvelope(
  samples: Float32Array,
  sampleRate: number,
  hopSec = 0.005,
): QuietEnvelope {
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { values: new Float32Array(0), rate: 1 };
  }
  const hop = Math.max(1, Math.round(hopSec * sampleRate));
  const count = Math.max(1, Math.ceil(samples.length / hop));
  const values = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const from = i * hop;
    const to = Math.min(samples.length, from + hop);
    let sum = 0;
    for (let j = from; j < to; j += 1) {
      sum += samples[j] * samples[j];
    }
    values[i] = to > from ? Math.sqrt(sum / (to - from)) : 0;
  }

  return { values, rate: sampleRate / hop };
}

export type SnapEdge = "start" | "end";

export interface SnapOptions {
  /** עד כמה רחוק מותר להזיז את החיתוך, בשניות. */
  windowSec?: number;
  /**
   * כמה שקט נדרש כדי להזיז בכלל, כשבר מהעוצמה האופיינית של הדיבור בקובץ.
   * אם אין באזור נקודה שקטה כל כך — לא מזיזים, כי הזזה לתוך דיבור גרועה
   * יותר מהזמן המקורי.
   */
  quietFraction?: number;
  /**
   * כמה זמן של שקט רצוף נדרש כדי שייחשב הפסקה אמיתית.
   * בלי זה, הרגע הסגור שלפני אות כמו ב' או ת' — שהוא שקט לחלוטין
   * אבל נמשך מאית שנייה — היה נראה כמו הפסקה, והחיתוך היה נופל
   * באמצע מילה.
   */
  minQuietSec?: number;
  /**
   * כמה להתרחק מגבול הדיבור לתוך השקט, לביטחון.
   * גבול השקט הוא בדיוק המקום שבו הדיבור מתחיל, וחיתוך עליו ממש
   * מגלח לפעמים את תחילת ההגייה.
   */
  marginSec?: number;
}

const DEFAULT_SNAP_WINDOW_SEC = 0.3;
const DEFAULT_QUIET_FRACTION = 0.25;
const DEFAULT_MIN_QUIET_SEC = 0.06;
const DEFAULT_MARGIN_SEC = 0.03;

/** העוצמה האופיינית של הדיבור בקובץ — האחוזון ה-75 של המעטפת. */
export function speechLevel(envelope: QuietEnvelope): number {
  const { values } = envelope;
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75))];
}

/**
 * מזיז זמן אחד אל ההפסקה הקרובה ביותר, בתוך חלון מוגבל.
 *
 * הכלל, בשלושה שלבים:
 *   1. מאתרים בחלון את כל קטעי השקט הרצופים שארוכים מספיק כדי
 *      להיחשב הפסקה אמיתית ולא רגע סגור בתוך מילה.
 *   2. בוחרים את הקטע הקרוב ביותר לזמן שהמנוע נתן.
 *   3. נכנסים לתוכו בנקודה הקרובה ביותר לזמן המקורי, ומתרחקים
 *      ממנו מעט החוצה — אחורה בקצה ההתחלה, קדימה בקצה הסיום —
 *      כדי לא לגלח את תחילת או סוף ההגייה.
 *
 * כך החיתוך נשאר צמוד לדיבור ולא מוסיף שקט מיותר, ובכל זאת אינו
 * נופל על ההגייה עצמה. אם אין בחלון הפסקה אמיתית, הזמן נשאר כפי
 * שהוא — הזזה לתוך דיבור גרועה מהזמן המקורי.
 */
export function findQuietPoint(
  envelope: QuietEnvelope,
  targetSec: number,
  edge: SnapEdge,
  options: SnapOptions = {},
): number {
  const { values, rate } = envelope;
  if (!values.length || !Number.isFinite(targetSec) || targetSec < 0) return targetSec;

  const windowSec = Math.max(0, options.windowSec ?? DEFAULT_SNAP_WINDOW_SEC);
  if (windowSec === 0) return targetSec;

  const threshold = speechLevel(envelope) * (options.quietFraction ?? DEFAULT_QUIET_FRACTION);
  const minRun = Math.max(1, Math.round((options.minQuietSec ?? DEFAULT_MIN_QUIET_SEC) * rate));
  const margin = Math.max(0, options.marginSec ?? DEFAULT_MARGIN_SEC);

  const centre = Math.round(targetSec * rate);
  const span = Math.max(1, Math.round(windowSec * rate));
  const from = Math.max(0, centre - span);
  const to = Math.min(values.length - 1, centre + span);
  if (to < from) return targetSec;

  // שלב 1 — קטעי השקט הרצופים שבחלון
  const runs: Array<{ from: number; to: number }> = [];
  let runStart = -1;
  for (let i = from; i <= to; i += 1) {
    if (values[i] <= threshold) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      if (i - runStart >= minRun) runs.push({ from: runStart, to: i - 1 });
      runStart = -1;
    }
  }
  if (runStart >= 0 && to - runStart + 1 >= minRun) runs.push({ from: runStart, to });
  if (!runs.length) return targetSec;

  // שלב 2 — הקטע הקרוב ביותר לזמן המקורי
  const distance = (run: { from: number; to: number }) => (
    centre < run.from ? run.from - centre : centre > run.to ? centre - run.to : 0
  );
  let best = runs[0];
  for (const run of runs) {
    if (distance(run) < distance(best)) best = run;
  }

  // שלב 3 — הנקודה הקרובה ביותר בתוכו, ואז מעט החוצה
  const runFromSec = best.from / rate;
  const runToSec = best.to / rate;
  const inside = Math.min(Math.max(targetSec, runFromSec), runToSec);
  return edge === "start"
    ? Math.max(runFromSec, inside - margin)
    : Math.min(runToSec, inside + margin);
}

/** מזיז את שני קצות הטווח לרגעי השקט הקרובים, ושומר שהטווח נשאר תקין. */
export function snapRangeToQuiet(
  range: AudioRange,
  envelope: QuietEnvelope,
  options: SnapOptions = {},
): AudioRange {
  if (!envelope.values.length) return range;

  const startSec = Math.max(0, findQuietPoint(envelope, range.startSec, "start", options));
  const endSec = findQuietPoint(envelope, range.endSec, "end", options);

  // הזזה שהפכה את הטווח או קיצרה אותו מדי — עדיף לא להזיז בכלל.
  if (endSec - startSec < MIN_RANGE_SEC) return range;

  return { ...range, startSec, endSec };
}

/** הזזה ידנית של קצה אחד בכמות קבועה, בתוך גבולות הקובץ. */
export function nudgeRange(
  range: AudioRange,
  edge: SnapEdge,
  deltaSec: number,
  durationSec: number,
): AudioRange {
  const limit = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : Infinity;
  if (edge === "start") {
    const startSec = Math.min(
      Math.max(0, range.startSec + deltaSec),
      range.endSec - MIN_RANGE_SEC,
    );
    return { ...range, startSec };
  }
  const endSec = Math.max(
    Math.min(limit, range.endSec + deltaSec),
    range.startSec + MIN_RANGE_SEC,
  );
  return { ...range, endSec };
}
