/**
 * זיהוי לולאת חזרות בתמלול.
 *
 * מה קורה כאן
 * ------------
 * מנוע התמלול נתקע לפעמים על קטע ומוציא את אותו משפט שוב ושוב. זה לא
 * תיאורטי: בשיעור אמיתי של 46 דקות יצא המשפט "אבו נמשום מתלס, עמוד
 * כנז בישראל" **אחת עשרה פעמים ברצף** בפתיחה, במקום הדברים שנאמרו שם.
 *
 * מה שמסוכן בזה: השאר של התמלול היה תקין וטוב. התקלה מרוכזת בקטע אחד
 * ונראית כמו טקסט רגיל, ולכן אפשר לקרוא את התמלול ולא לשים לב שחסר
 * בו חצי דקה.
 *
 * מה היה שבור קודם
 * -----------------
 * הייתה כבר בדיקה, אבל היא תפסה רק **מילה בודדת** שחוזרת שבע פעמים.
 * לולאה של משפט שלם — שזה מה שקורה בפועל — חמקה ממנה לגמרי. היא גם
 * רצה רק כששפת הדיבור הייתה "זיהוי אוטומטי", ולכן מי שקבע עברית
 * במפורש נשאר בלי שום הגנה.
 *
 * איך מבדילים מדיבור רגיל
 * ------------------------
 * אדם חוזר על עצמו, וזה תקין. באותו שיעור "למה" הופיע ארבע פעמים
 * ו"זה ההבדל" שלוש — ואלה דברים שבאמת נאמרו.
 *
 * ההבדל הוא באורך ובצמידות: לולאה שבורה היא ביטוי **ארוך** שחוזר
 * **ברצף**. אדם אומר "למה, למה" — הוא לא אומר משפט בן חמש מילים
 * שלוש פעמים רצופות בלי לשנות מילה.
 */

export interface RepetitionLoop {
  /** הביטוי שחזר. */
  phrase: string;
  /** כמה פעמים ברצף. */
  times: number;
  /** כמה מילים בביטוי. */
  phraseWords: number;
  /** איזה חלק מהתמלול הלולאה תופסת, בין 0 ל-1. */
  share: number;
}

/** ביטוי קצר מזה חוזר גם בדיבור רגיל. */
export const MIN_LOOP_WORDS = 3;

/** פחות מזה אינו לולאה אלא הדגשה. */
export const MIN_LOOP_TIMES = 3;

/** מילה בודדת צריכה הרבה יותר חזרות כדי להיחשב תקלה. */
export const MIN_SINGLE_WORD_TIMES = 7;

/** מנקה פיסוק ורווחים כדי להשוות ביטויים. */
function key(segment: string): string {
  return segment
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function wordCount(text: string): number {
  const t = key(text);
  return t ? t.split(' ').length : 0;
}

/**
 * מוצא את הלולאה החמורה ביותר, או כלום אם אין.
 *
 * מחפשים רצפים צמודים בלבד. ביטוי שחוזר בפתיחה ושוב בסוף הוא כמעט
 * תמיד דיבור אמיתי; ביטוי שחוזר חמש פעמים בלי הפסקה הוא תקלה.
 */
export function findRepetitionLoop(text: string): RepetitionLoop | null {
  if (!text || !text.trim()) return null;

  const segments = text.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  const totalWords = wordCount(text);
  if (totalWords === 0) return null;

  let best: RepetitionLoop | null = null;

  let i = 0;
  while (i < segments.length) {
    const k = key(segments[i]);
    if (!k) { i++; continue; }

    let j = i + 1;
    while (j < segments.length && key(segments[j]) === k) j++;

    const times = j - i;
    const words = k.split(' ').length;
    const enough = words === 1 ? MIN_SINGLE_WORD_TIMES : MIN_LOOP_TIMES;

    if (times >= enough && (words >= MIN_LOOP_WORDS || words === 1)) {
      const share = (words * times) / totalWords;
      if (!best || times > best.times) {
        best = { phrase: segments[i], times, phraseWords: words, share };
      }
    }
    i = j;
  }

  return best;
}

/**
 * האם כדאי לנסות שוב.
 *
 * כל לולאה שנמצאה כבר עברה את הסף, ולכן התשובה היא פשוט "נמצאה".
 * הפונקציה קיימת בנפרד כי זה מה שהקוד שמשתמש בה באמת שואל.
 */
export function hasRepetitionLoop(text: string): boolean {
  return findRepetitionLoop(text) !== null;
}

/** מה לומר למשתמש כשנמצאה לולאה. */
export function describeLoop(loop: RepetitionLoop): string {
  const short = loop.phrase.length > 40 ? loop.phrase.slice(0, 40) + '…' : loop.phrase;
  const pct = Math.round(loop.share * 100);
  const part = pct >= 1 ? ` — כ-${pct} אחוז מהתמלול` : '';
  return `המנוע נתקע וחזר ${loop.times} פעמים על "${short}"${part}`;
}
