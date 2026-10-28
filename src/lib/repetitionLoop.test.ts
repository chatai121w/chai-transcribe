import { describe, expect, it } from 'vitest';
import {
  describeLoop, findRepetitionLoop, hasRepetitionLoop, MIN_SINGLE_WORD_TIMES,
} from './repetitionLoop';

/**
 * זיהוי לולאת חזרות.
 *
 * הדוגמאות כאן אינן מומצאות. הן מתוך תמלול אמיתי של שיעור בן 46 דקות:
 * המשפט "אבו נמשום מתלס, עמוד כנז בישראל" יצא אחת עשרה פעמים ברצף
 * בפתיחה, ובאותו תמלול עצמו "למה" הופיע ארבע פעמים ו"זה ההבדל" שלוש —
 * ואלה דברים שבאמת נאמרו.
 *
 * שתי הטעויות שאפשר לעשות כאן, ושתיהן עולות למשתמש:
 *
 *   לפספס לולאה     התמלול נראה תקין, הקורא לא שם לב, וחצי דקה
 *                   מהשיעור פשוט חסרה.
 *
 *   לזעוק על דיבור  המערכת תריץ שוב כל תמלול שבו מישהו חזר על
 *   רגיל            עצמו — והמשתמש יחכה פי שניים בלי סיבה.
 */

const LOOP = 'אבו נמשום מתלס, עמוד כנז בישראל';

const realLoop = [
  'כל הלשון, כל התורה, בכל מקום',
  ...Array(11).fill(LOOP),
  'אבו נהניתם תם לפגם',
].join('. ') + '.';

describe('תפיסת לולאה אמיתית', () => {
  it('הלולאה מהשיעור נתפסת', () => {
    const loop = findRepetitionLoop(realLoop);
    expect(loop).not.toBeNull();
    expect(loop!.times).toBe(11);
    expect(loop!.phrase).toContain('אבו נמשום');
  });

  it('גם שלוש חזרות של משפט שלם נתפסות', () => {
    // זה הסף. אדם אינו אומר משפט בן חמש מילים שלוש פעמים רצופות
    // בלי לשנות מילה אחת.
    const t = 'שלום לכולם. ' + 'הכלי היה מנוקה מאוד. '.repeat(3) + 'וזהו.';
    expect(hasRepetitionLoop(t)).toBe(true);
  });

  it('החלק שהלולאה תופסת מחושב', () => {
    const loop = findRepetitionLoop(realLoop);
    expect(loop!.share).toBeGreaterThan(0.5);
    expect(loop!.share).toBeLessThanOrEqual(1);
  });

  it('פיסוק שונה אינו מסתיר את הלולאה', () => {
    const t = 'הכלי היה מנוקה! הכלי היה מנוקה. הכלי, היה מנוקה? וזהו.';
    expect(hasRepetitionLoop(t)).toBe(true);
  });
});

describe('דיבור רגיל אינו נתפס', () => {
  it('מילה בודדת שחוזרת כמה פעמים היא דיבור', () => {
    // "למה" הופיע ארבע פעמים באותו שיעור, וזה מה שנאמר.
    expect(hasRepetitionLoop('למה. למה. למה. למה. אז בוא נבין.')).toBe(false);
  });

  it('ביטוי קצר שחוזר שלוש פעמים אינו לולאה', () => {
    // "זה ההבדל" הופיע שלוש פעמים — שתי מילים, דיבור של מרצה.
    expect(hasRepetitionLoop('זה ההבדל. זה ההבדל. זה ההבדל. נמשיך.')).toBe(false);
  });

  it('אותו משפט בפתיחה ובסוף אינו לולאה', () => {
    // חזרה על רעיון בסיום השיעור היא דיבור, לא תקלה. רק רצף צמוד נחשב.
    const t = 'הכלי היה מנוקה מאוד. דברים באמצע. עוד דברים. הכלי היה מנוקה מאוד.';
    expect(hasRepetitionLoop(t)).toBe(false);
  });

  it('תמלול ארוך ותקין עובר בשלום', () => {
    const t = Array.from({ length: 40 }, (_, i) => `משפט מספר ${i} עם תוכן אמיתי`).join('. ');
    expect(hasRepetitionLoop(t)).toBe(false);
  });
});

describe('מילה בודדת', () => {
  it('שש פעמים עדיין דיבור', () => {
    expect(hasRepetitionLoop('כן. כן. כן. כן. כן. כן.')).toBe(false);
  });

  it('מעבר לסף זאת כבר תקלה', () => {
    const t = Array(MIN_SINGLE_WORD_TIMES + 1).fill('כן').join('. ');
    expect(hasRepetitionLoop(t)).toBe(true);
  });
});

describe('מקרי קצה', () => {
  it('טקסט ריק אינו מפיל', () => {
    expect(findRepetitionLoop('')).toBeNull();
    expect(findRepetitionLoop('   ')).toBeNull();
  });

  it('טקסט של פיסוק בלבד אינו מפיל', () => {
    expect(findRepetitionLoop('... !!! ???')).toBeNull();
  });

  it('משפט אחד אינו לולאה', () => {
    expect(hasRepetitionLoop('הכלי היה מנוקה מאוד')).toBe(false);
  });
});

describe('מה שהמשתמש קורא', () => {
  it('ההודעה אומרת כמה פעמים ומה חזר', () => {
    const text = describeLoop(findRepetitionLoop(realLoop)!);
    expect(text).toContain('11');
    expect(text).toContain('אבו נמשום');
  });

  it('ביטוי ארוך נחתך ואינו מציף את ההודעה', () => {
    const long = Array(5).fill('מילה אחת ועוד מילה ועוד אחת ועוד ועוד ועוד ועוד').join('. ');
    const text = describeLoop(findRepetitionLoop(long)!);
    expect(text).toContain('…');
    expect(text.length).toBeLessThan(120);
  });

  it('אין אנגלית בהודעה', () => {
    expect(describeLoop(findRepetitionLoop(realLoop)!)).not.toMatch(/[A-Za-z]{3,}/);
  });
});
