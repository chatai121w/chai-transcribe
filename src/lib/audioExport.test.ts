import { describe, expect, it } from 'vitest';
import {
  applyGain, canEncodeMp3, encodeWav, gainToDb, levelGain, peakLevel,
  practicalPeak, rmsLevel, softClip, speechLevel, applyHumNotchOff, HUM_NOTCH_Q,
} from './audioExport';

/**
 * התאמת העוצמה בייצוא.
 *
 * הבדיקות כאן אינן על "האם זה נשמע טוב" — זה דבר שרק האוזן קובעת.
 * הן על ההבטחות שאפשר לשבור בלי לשמוע:
 *
 *   השיא לא עובר      קובץ שעבר את התקרה מתעוות, והעיוות נשמע
 *                     גרוע יותר מקובץ חלש.
 *
 *   שקט נשאר שקט      חלוקה באפס הייתה נותנת מכפיל אינסופי ומהפכת
 *                     קטע שקט לרעש בעוצמה מלאה.
 *
 *   דפיקה בודדת       מדידה לפי השיא נופלת כאן: דפיקה אחת מספיקה
 *   לא מרמה           כדי שהתוכנה תחשוב שהקטע חזק, והדיבור יישאר
 *                     בלתי נשמע — בדיוק התלונה שבגללה זה נכתב.
 */

const tone = (n: number, amp: number) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((i / 20) * Math.PI * 2));

describe('מדידת עוצמה', () => {
  it('השיא הוא הדגימה החזקה ביותר', () => {
    expect(peakLevel(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7, 5);
  });

  it('העוצמה הממוצעת של שקט היא אפס', () => {
    expect(rmsLevel(new Float32Array(100))).toBe(0);
  });

  it('קטע ריק אינו מפיל', () => {
    expect(peakLevel(new Float32Array(0))).toBe(0);
    expect(rmsLevel(new Float32Array(0))).toBe(0);
  });
});

describe('מכפיל העוצמה', () => {
  it('מגביר הקלטה חלשה', () => {
    const quiet = tone(2000, 0.01);
    expect(levelGain(quiet)).toBeGreaterThan(5);
  });

  it('מנמיך הקלטה חזקה מדי', () => {
    const loud = tone(2000, 0.99);
    expect(levelGain(loud)).toBeLessThan(1);
  });

  it('התוצאה לעולם אינה עוברת את התחום', () => {
    for (const amp of [0.001, 0.01, 0.1, 0.5, 0.99]) {
      const out = applyGain(tone(2000, amp), levelGain(tone(2000, amp)));
      expect(peakLevel(out), `עוצמה ${amp}`).toBeLessThanOrEqual(1);
    }
  });

  it('שקט מוחלט נשאר כמו שהוא', () => {
    // בלי זה: חלוקה באפס, מכפיל אינסופי, וקובץ של רעש בעוצמה מלאה.
    expect(levelGain(new Float32Array(500))).toBe(1);
  });

  it('אינו מגביר בלי גבול', () => {
    // קטע שהוא כמעט רק רעש רקע — הגברה בלי גבול הופכת אותו לרעש צורם.
    const almostNothing = tone(2000, 0.00001);
    expect(levelGain(almostNothing)).toBeLessThanOrEqual(32);
  });

  it('דפיקה בודדת אינה מונעת את ההגברה', () => {
    // זה הלב של העניין, והמקרה שבגללו הקובץ יצא בלי קול.
    // דיבור חלש עם רגע חזק אחד: מדידה לפי השיא ממש הסיקה "הקטע
    // חזק", נתנה מכפיל של 1.19 בלבד, והדיבור נשאר בלתי נשמע.
    //
    // הבדיקה היא על התוצאה ולא על המכפיל: "המכפיל גדול מ-1" היה
    // עובר גם ב-1.19. מה שחשוב הוא שהקטע באמת נשמע בסוף.
    const speech = tone(40000, 0.01);
    speech[500] = 0.9;

    const out = applyGain(speech, levelGain(speech));
    expect(rmsLevel(out)).toBeGreaterThan(0.06);
  });

  it('אותה הקלטה בלי הדפיקה מגיעה לאותה עוצמה', () => {
    // אם הדפיקה עדיין משנה את התוצאה באופן מורגש, לא פתרנו כלום.
    const clean = tone(40000, 0.01);
    const knocked = tone(40000, 0.01);
    knocked[500] = 0.9;

    const a = rmsLevel(applyGain(clean, levelGain(clean)));
    const b = rmsLevel(applyGain(knocked, levelGain(knocked)));
    expect(Math.abs(a - b) / a).toBeLessThan(0.02);
  });

  it('הקלטה עם הרבה שתיקות אינה מוגברת יתר על המידה', () => {
    // בלי התעלמות מהשקט, הממוצע של קטע שרובו שתיקה יוצא נמוך,
    // התוכנה מסיקה "חלש מאוד" ומגבירה — והשקט הופך לרעש רועם.
    const speech = tone(44100, 0.1);
    const mostlySilent = new Float32Array(44100 * 5);
    mostlySilent.set(speech, 0);

    const dense = levelGain(speech);
    const sparse = levelGain(mostlySilent);
    expect(Math.abs(dense - sparse) / dense).toBeLessThan(0.05);
  });
});

describe('עוצמת הדיבור', () => {
  it('שקט מוחלט מחזיר אפס', () => {
    expect(speechLevel(new Float32Array(44100))).toBe(0);
  });

  it('קטע ריק מחזיר אפס ולא שגיאה', () => {
    expect(speechLevel(new Float32Array(0))).toBe(0);
  });

  it('אינו מושפע מאורך השתיקות', () => {
    const speech = tone(44100, 0.2);
    const withTail = new Float32Array(44100 * 4);
    withTail.set(speech, 0);
    expect(speechLevel(withTail)).toBeCloseTo(speechLevel(speech), 2);
  });
});

describe('השיא המעשי', () => {
  it('מתעלם מרגע חזק בודד', () => {
    const s = tone(40000, 0.1);
    s[7] = 0.95;
    expect(practicalPeak(s)).toBeLessThan(0.3);
  });

  it('אינו מתעלם מחומר שחזק לכל אורכו', () => {
    expect(practicalPeak(tone(40000, 0.9))).toBeGreaterThan(0.7);
  });

  it('קטע ריק מחזיר אפס ולא שגיאה', () => {
    expect(practicalPeak(new Float32Array(0))).toBe(0);
  });
});

describe('ריכוך הפסגות', () => {
  it('צליל רגיל עובר בלי שינוי', () => {
    expect(softClip(0.5)).toBe(0.5);
    expect(softClip(-0.5)).toBe(-0.5);
  });

  it('פסגה חזקה נדחסת ואינה נחתכת לקו שטוח', () => {
    // חיתוך ישר היה נותן בדיוק 1 לשני הערכים, והאוזן שומעת נקישה.
    const a = softClip(1.5);
    const b = softClip(3.0);
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(1);
    expect(b).toBeGreaterThan(a);
  });

  it('גם ערך עצום אינו עובר את התחום', () => {
    expect(Math.abs(softClip(500))).toBeLessThanOrEqual(1);
    expect(Math.abs(softClip(-500))).toBeLessThanOrEqual(1);
  });
});

describe('הגבלת ערכים', () => {
  it('לא נוצרות דגימות מעבר לתחום', () => {
    const out = applyGain(new Float32Array([0.8, -0.8]), 10);
    expect(out[0]).toBeLessThanOrEqual(1);
    expect(out[1]).toBeGreaterThanOrEqual(-1);
    expect(out[0]).toBeGreaterThan(0.9);
  });

  it('המקור אינו משתנה', () => {
    const src = new Float32Array([0.5]);
    applyGain(src, 2);
    expect(src[0]).toBe(0.5);
  });
});

describe('תצוגה למשתמש', () => {
  it('מכפיל 1 הוא אפס דציבל', () => {
    expect(gainToDb(1)).toBeCloseTo(0, 5);
  });

  it('הכפלה היא בערך שישה דציבל', () => {
    expect(gainToDb(2)).toBeCloseTo(6.02, 1);
  });
});

describe('כיבוי חיתוך רעש החשמל', () => {
  it('רוחב החיתוך במצב כבוי גדול, לא קטן', () => {
    // התקלה שהייתה כאן: הערך היה 0.0001 מתוך מחשבה ש"קטן = השפעה
    // קטנה". זה הפוך. מספר קטן פירושו חיתוך רחב מאוד, והתוצאה
    // הייתה שרק שלושה אחוזים מהקול עברו — גם בייצוא וגם בהשמעה.
    //
    // הבדיקה שומרת על הכיוון ולא על המספר המדויק: כל ערך קטן כאן
    // מחזיר את הבעיה.
    const node = { frequency: { value: 0 }, Q: { value: 0 } } as BiquadFilterNode;
    applyHumNotchOff(node);
    expect(node.Q.value).toBeGreaterThanOrEqual(10);
  });

  it('התדר במצב כבוי מתחת לתחום השמיעה', () => {
    const node = { frequency: { value: 0 }, Q: { value: 0 } } as BiquadFilterNode;
    applyHumNotchOff(node);
    expect(node.frequency.value).toBeLessThan(20);
  });

  it('במצב פעיל החיתוך צר דיו כדי לא לפגוע בדיבור', () => {
    // רוחב החיתוך הוא התדר חלקי המספר הזה. ב-50 הרץ עם 10 זה
    // חמישה הרץ — סביב הזמזום בלבד.
    expect(50 / HUM_NOTCH_Q).toBeLessThan(10);
  });
});

describe('כתיבת הקובץ', () => {
  it('הכותרת באורך הנכון והגודל מתאים למספר הדגימות', () => {
    const blob = encodeWav(new Float32Array(1000), 44100);
    expect(blob.size).toBe(44 + 1000 * 2);
    expect(blob.type).toBe('audio/wav');
  });

  it('הדחיסה מקבלת את קצב הדגימה של התוכנה', () => {
    expect(canEncodeMp3(44100)).toBe(true);
    expect(canEncodeMp3(16000)).toBe(true);
  });

  it('קצב דגימה חריג נדחה במפורש ולא מייצר קובץ פגום', () => {
    expect(canEncodeMp3(37000)).toBe(false);
  });
});
