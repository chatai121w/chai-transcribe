import { describe, it, expect } from 'vitest';
import {
  toAshkenazi,
  stripNikud,
  hasNikud,
  nikudCoverage,
  prepareAshkenaziSpeech,
} from './ashkenaziSpeech';

/**
 * שש הדוגמאות האלה הן אותן דוגמאות שנבדקו בתסריט הפייתון ועברו שם.
 * הן קיימות כאן כדי שאם מישהו ישנה את הכללים בקוד האתר, הבדיקה תיפול
 * ולא נגלה את זה רק כששומעים שההקראה נשמעת ישראלית.
 */
describe('המרה להגייה אשכנזית-ליטאית', () => {
  const cases: Array<[string, string, string]> = [
    ['תּוֹרָה', 'תוירה', 'חולם נשמע OY, והקמץ בהברה האחרונה נבלע'],
    ['שַׁבָּת', 'שבוס', 'קמץ נשמע O, ת רפה נשמעת ס'],
    ['אֱמֶת', 'אמעס', 'סגול, ו-ת רפה'],
    ['חֹדֶשׁ', 'חוידעש', 'חולם על האות עצמה'],
    ['גְּמָרָא', 'גמורא', 'קמץ אחד נשמע O והשני נבלע'],
    ['עוֹלָם', 'עוילום', 'חולם על ו, וקמץ לפני אות סוגרת'],
  ];

  for (const [voweled, expected, why] of cases) {
    it(`${stripNikud(voweled)} → ${expected} (${why})`, () => {
      expect(toAshkenazi(voweled)).toBe(expected);
    });
  }

  it('תי"ו דגושה נשארת ת ואינה הופכת ל-ס', () => {
    // זה ההבדל בין "שבוס" ל"שבות" — אם הדגש לא נבדק, כל ת הופכת ל-ס.
    expect(toAshkenazi('תּוֹרָה')).toContain('ת');
    expect(toAshkenazi('תּוֹרָה')).not.toContain('ס');
  });

  it('אינה מוסיפה ו נוספת כשהאות עצמה היא ו', () => {
    // הבאג שהיה: "תּוֹרָה" יצא "תווירוה".
    expect(toAshkenazi('תּוֹרָה')).not.toContain('תוו');
  });

  it('מעבירה טקסט לא מנוקד כמו שהוא', () => {
    expect(toAshkenazi('שלום עולם')).toBe('שלום עולם');
  });

  it('שומרת על פיסוק ורווחים', () => {
    const result = toAshkenazi('שַׁבָּת, שָׁלוֹם!');
    expect(result).toContain(',');
    expect(result).toContain('!');
  });

  it('אינה קורסת על טקסט ריק', () => {
    expect(toAshkenazi('')).toBe('');
    expect(toAshkenazi(null as unknown as string)).toBe('');
  });
});

describe('זיהוי ניקוד', () => {
  it('מזהה שיש ניקוד', () => {
    expect(hasNikud('שַׁבָּת')).toBe(true);
    expect(hasNikud('שבת')).toBe(false);
  });

  it('מודד אחוז מילים מנוקדות', () => {
    const c = nikudCoverage('שַׁבָּת שלום');
    expect(c.total).toBe(2);
    expect(c.voweled).toBe(1);
    expect(c.percent).toBe(50);
  });

  it('אינה מתבלבלת ממספרים ומפיסוק', () => {
    const c = nikudCoverage('123 , שַׁבָּת');
    expect(c.total).toBe(1);
    expect(c.voweled).toBe(1);
  });
});

describe('הכנה להקראה', () => {
  it('מזהירה כשאין ניקוד בכלל', () => {
    const r = prepareAshkenaziSpeech('שלום עולם');
    expect(r.warning).toContain('אינו מנוקד');
    expect(r.changedWords).toBe(0);
  });

  it('מזהירה כשרק מעט מנוקד', () => {
    const r = prepareAshkenaziSpeech('שַׁבָּת שלום לכל בית ישראל');
    expect(r.warning).toContain('אחוז');
  });

  it('אינה מזהירה כשהטקסט מנוקד כולו', () => {
    const r = prepareAshkenaziSpeech('שַׁבָּת שָׁלוֹם');
    expect(r.warning).toBe('');
    expect(r.changedWords).toBeGreaterThan(0);
  });

  it('סופרת כמה מילים באמת השתנו', () => {
    // בלי זה המשתמש לא יודע אם ההמרה עשתה משהו או לא.
    const r = prepareAshkenaziSpeech('תּוֹרָה');
    expect(r.changedWords).toBe(1);
    expect(r.text).toBe('תוירה');
  });
});
