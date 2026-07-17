import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyLoshonKodeshReplacements,
  getLoshonKodeshHotwordsList,
  getLoshonKodeshReplacements,
  setLoshonKodeshHotwordsList,
  setLoshonKodeshReplacements,
} from './loshonKodesh';

describe('Loshon Kodesh contextual corrections', () => {
  beforeEach(() => localStorage.clear());

  it('corrects anchored Torah phrases while preserving ordinary Hebrew', () => {
    const input = [
      'אנחנו עוסקים היום במצווה חשובה ויקרה.',
      'יש שני מושגים: פדיון הקדיש ופדיון מעשה שני.',
      'אנחנו קוראים יוחנן ונשלוקש ושואלים איך קונים מטלטלן.',
      'בפסוק נאמר כל פתע רחם לכל בוסר שיקריבו לשם.',
    ].join(' ');

    expect(applyLoshonKodeshReplacements(input)).toBe([
      'אנחנו עוסקים היום במצווה חשובה ויקרה.',
      'יש שני מושגים: פדיון הקדש ופדיון מעשר שני.',
      'אנחנו קוראים רבי יוחנן וריש לקיש ושואלים איך קונים מטלטלין.',
      'בפסוק נאמר כל פטר רחם לכל בשר אשר יקריבו לה׳.',
    ].join(' '));
  });

  it('merges new built-in knowledge with existing user entries', () => {
    setLoshonKodeshHotwordsList(['מונח אישי']);
    setLoshonKodeshReplacements([{ from: 'שיבוש אישי', to: 'תיקון אישי', category: 'terms' }]);

    expect(getLoshonKodeshHotwordsList()).toContain('מעשר שני');
    expect(getLoshonKodeshHotwordsList()).toContain('מונח אישי');
    expect(getLoshonKodeshReplacements()).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'פדיון מעשה שני', to: 'פדיון מעשר שני' }),
      expect.objectContaining({ from: 'שיבוש אישי', to: 'תיקון אישי' }),
    ]));
  });

  it('repairs the observed mixed modern-Hebrew and rabbinic excerpt', () => {
    const input = 'פדיון הקדיש זה קניין. הקדיש הוא רשות, ויש לו נכסים. נכסים רבים היו להקדיש בימי קדם, ופדיון הקדיש זה גדר קנייני. אדם נותן כסף להקדיש וקונה מה שהקדיש מוכר. הקדיש בית ובית בקדושת ממון. סילוק הקדושה היא תוצאה של כליין. לא כך מעשה שני, כי נחלקו המעשה שני מומן גבוה או מומן בעלם.';
    const output = applyLoshonKodeshReplacements(input);

    expect(output).toContain('פדיון הקדש זה קניין');
    expect(output).toContain('הקדש הוא רשות');
    expect(output).toContain('נכסים רבים היו להקדש');
    expect(output).toContain('מה שהקדש מוכר');
    expect(output).toContain('הקדש בדק הבית בקדושת ממון');
    expect(output).toContain('תוצאה של קניין');
    expect(output).toContain('המעשר שני ממון גבוה או ממון בעלים');
  });
});
