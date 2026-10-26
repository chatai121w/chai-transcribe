import { describe, expect, it } from 'vitest';
import {
  formatRangeLength, markEnd, markStart, MIN_RANGE_SEC, type FocusRange,
} from './focusRange';

/**
 * קביעת ההתחלה והסוף.
 *
 * ההבטחה היחידה שחשובה כאן: **הטווח לעולם אינו מתכווץ.**
 *
 * טווח באורך אפס אינו נראה במסך — שני הסימונים נופלים זה על זה,
 * והמשתמש רואה סימון אחד ומסיק שהתוכנה שבורה. זה בדיוק מה שקרה,
 * ולכן כל בדיקה כאן נגמרת באותה שאלה: האם נשאר טווח שאפשר לראות.
 */

const DUR = 25;
const len = (r: FocusRange) => r.end - r.start;

describe('קביעת ההתחלה', () => {
  it('לפני הסוף — הסוף אינו זז', () => {
    const { range, moved } = markStart({ start: 0, end: 20 }, 5, DUR);
    expect(range).toEqual({ start: 5, end: 20 });
    expect(moved).toBeNull();
  });

  it('אחרי הסוף — הסוף נדחף קדימה', () => {
    const { range, moved } = markStart({ start: 0, end: 5 }, 15, DUR);
    expect(range.start).toBe(15);
    expect(range.end).toBeGreaterThan(15);
    expect(moved).toBe('end');
  });

  it('בסוף ממש של ההקלטה — עדיין נשאר טווח', () => {
    const { range } = markStart({ start: 0, end: 5 }, DUR, DUR);
    expect(len(range)).toBeGreaterThanOrEqual(MIN_RANGE_SEC);
    expect(range.end).toBeLessThanOrEqual(DUR);
  });
});

describe('קביעת הסוף', () => {
  it('אחרי ההתחלה — ההתחלה אינה זזה', () => {
    const { range, moved } = markEnd({ start: 3, end: 25 }, 12, DUR);
    expect(range).toEqual({ start: 3, end: 12 });
    expect(moved).toBeNull();
  });

  it('לפני ההתחלה — ההתחלה נסוגה אחורה', () => {
    // זה הכיוון שהיה שבור: הטווח התכווץ לאפס ונראה סימון אחד.
    const { range, moved } = markEnd({ start: 15, end: 25 }, 5, DUR);
    expect(range.end).toBe(5);
    expect(range.start).toBeLessThan(5);
    expect(moved).toBe('start');
  });

  it('בתחילת ההקלטה ממש — ההתחלה אינה יורדת מתחת לאפס', () => {
    const { range } = markEnd({ start: 15, end: 25 }, 0.5, DUR);
    expect(range.start).toBeGreaterThanOrEqual(0);
    expect(len(range)).toBeGreaterThanOrEqual(MIN_RANGE_SEC);
  });
});

describe('הטווח לעולם אינו מתכווץ', () => {
  it('בכל סדר ובכל מיקום', () => {
    // הבדיקה המרכזית. כל צירוף של שתי לחיצות, בכל נקודה —
    // ובכולם חייב להישאר טווח שרואים.
    const points = [0, 0.05, 1, 5, 12.5, 20, 24.9, DUR];
    for (const a of points) {
      for (const b of points) {
        let r: FocusRange = { start: 0, end: DUR };

        r = markStart(r, a, DUR).range;
        expect(len(r), `התחלה ${a}`).toBeGreaterThanOrEqual(MIN_RANGE_SEC);

        r = markEnd(r, b, DUR).range;
        expect(len(r), `התחלה ${a} ואז סוף ${b}`).toBeGreaterThanOrEqual(MIN_RANGE_SEC);

        // ובסדר ההפוך
        let r2: FocusRange = { start: 0, end: DUR };
        r2 = markEnd(r2, b, DUR).range;
        expect(len(r2), `סוף ${b}`).toBeGreaterThanOrEqual(MIN_RANGE_SEC);
        r2 = markStart(r2, a, DUR).range;
        expect(len(r2), `סוף ${b} ואז התחלה ${a}`).toBeGreaterThanOrEqual(MIN_RANGE_SEC);
      }
    }
  });

  it('ההתחלה תמיד לפני הסוף', () => {
    const points = [0, 2, 9, 17, DUR];
    for (const a of points) {
      for (const b of points) {
        const r = markEnd(markStart({ start: 0, end: DUR }, a, DUR).range, b, DUR).range;
        expect(r.start, `${a} ואז ${b}`).toBeLessThan(r.end);
      }
    }
  });

  it('שום סימון אינו חורג מההקלטה', () => {
    for (const p of [-5, 0, 12, DUR, DUR + 100]) {
      const r1 = markStart({ start: 0, end: DUR }, p, DUR).range;
      const r2 = markEnd({ start: 0, end: DUR }, p, DUR).range;
      for (const r of [r1, r2]) {
        expect(r.start, `נקודה ${p}`).toBeGreaterThanOrEqual(0);
        expect(r.end, `נקודה ${p}`).toBeLessThanOrEqual(DUR);
      }
    }
  });
});

describe('הקלטה קצרצרה', () => {
  it('גם בהקלטה של חצי שנייה נשאר טווח', () => {
    const short = 0.5;
    const r = markEnd(markStart({ start: 0, end: short }, 0.4, short).range, 0.05, short).range;
    expect(r.start).toBeGreaterThanOrEqual(0);
    expect(r.end).toBeLessThanOrEqual(short);
    expect(r.start).toBeLessThan(r.end);
  });
});

describe('אורך הטווח בתצוגה', () => {
  const clock = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  it('חצי שנייה אינה מוצגת כאפס', () => {
    // "00:00" גרם למשתמש להסיק שלא נבחר קטע, אף שהסימונים במקומם.
    expect(formatRangeLength(0.5, clock)).not.toContain('00:00');
    expect(formatRangeLength(0.5, clock)).toContain('0.5');
  });

  it('טווח ארוך מוצג כשעון רגיל', () => {
    expect(formatRangeLength(75, clock)).toBe('01:15');
  });

  it('ערך שלילי אינו מייצר טקסט מוזר', () => {
    expect(formatRangeLength(-3, clock)).toBe('0 שניות');
  });

  it('מספר שלם אינו מוצג עם שבריר', () => {
    // "5.0 שניות" נראה כמו פלט של מכונה.
    expect(formatRangeLength(5, clock)).toBe('5 שניות');
  });

  it('שנייה אחת נכתבת כמו שאומרים', () => {
    expect(formatRangeLength(1, clock)).toBe('שנייה אחת');
  });

  it('שבריר מוצג כשיש אחד', () => {
    expect(formatRangeLength(0.3, clock)).toBe('0.3 שניות');
  });
});
