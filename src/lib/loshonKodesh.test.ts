import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyLoshonKodeshReplacements,
  applyLoshonKodeshReplacementsDetailed,
  getCategoryEnabled,
  getLoshonKodeshHotwordsList,
  getLoshonKodeshReplacements,
  getDictionaries,
  normalizeHebrewFinalLettersDetailed,
  setCategoryEnabled,
  setDictionaries,
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

  it('contains no duplicate or no-op built-in replacement rules', () => {
    const rules = getLoshonKodeshReplacements();
    const sources = rules.map((rule) => rule.from);

    expect(new Set(sources).size).toBe(sources.length);
    expect(rules.every((rule) => rule.from !== rule.to)).toBe(true);
  });

  it('sanitizes stale saved duplicates and no-op rules on read', () => {
    setLoshonKodeshReplacements([
      { from: 'בייס', to: 'בית ישן', category: 'tsere' },
      { from: 'בייס', to: 'בית', category: 'tsere' },
      { from: 'דעת', to: 'דעת', category: 'general' },
    ]);

    const rules = getLoshonKodeshReplacements();
    expect(rules.filter((rule) => rule.from === 'בייס')).toEqual([
      expect.objectContaining({ to: 'בית' }),
    ]);
    expect(rules.some((rule) => rule.from === rule.to)).toBe(false);
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

  it('counts every replacement occurrence instead of reporting a binary change', () => {
    const result = applyLoshonKodeshReplacementsDetailed('פדיון הקדיש וגם פדיון הקדיש');

    expect(result.text).toBe('פדיון הקדש וגם פדיון הקדש');
    expect(result.appliedCount).toBe(2);
    expect(result.applied).toContainEqual(expect.objectContaining({
      from: 'פדיון הקדיש',
      to: 'פדיון הקדש',
      count: 2,
    }));
  });

  it('preserves common Hebrew prefixes around a corrected Torah term', () => {
    expect(applyLoshonKodeshReplacements('ופדיון הקדיש')).toBe('ופדיון הקדש');
  });

  it('respects category toggles', () => {
    setCategoryEnabled({ ...getCategoryEnabled(), terms: false });
    expect(applyLoshonKodeshReplacements('פדיון הקדיש')).toBe('פדיון הקדיש');
  });

  it('applies enabled dictionary replacements and reports their source', () => {
    setDictionaries([
      ...getDictionaries(),
      {
        id: 'test-dictionary',
        name: 'בדיקה',
        enabled: true,
        hotwords: [],
        replacements: [{ from: 'ארומך', to: 'ארוממך', category: 'terms' }],
      },
    ]);

    const result = applyLoshonKodeshReplacementsDetailed('ארומך אלוהי המלך');
    expect(result.text).toBe('ארוממך אלוהי המלך');
    expect(result.applied).toContainEqual(expect.objectContaining({ source: 'dictionary', count: 1 }));
  });

  it('normalizes medial and final מנצפך letters at Hebrew word boundaries', () => {
    const result = normalizeHebrewFinalLettersDetailed('שלומ מלכימ כנפ ארצ');

    expect(result.text).toBe('שלום מלכים כנף ארץ');
    expect(result.appliedCount).toBe(4);
  });

  it('restores a medial form when a final letter appears inside a word', () => {
    expect(normalizeHebrewFinalLettersDetailed('מלךים םשה').text).toBe('מלכים משה');
  });

  it('handles niqqud, punctuation and maqaf without joining word parts', () => {
    expect(normalizeHebrewFinalLettersDetailed('שָׁלוֹמ, מלכימ־טובימ.').text)
      .toBe('שָׁלוֹם, מלכים־טובים.');
  });

  it('preserves a single-letter abbreviation before geresh', () => {
    expect(normalizeHebrewFinalLettersDetailed('צ׳ ופ׳').text).toBe('צ׳ ופ׳');
  });

  it('preserves medial letters inside acronyms and fixes their final letter', () => {
    expect(normalizeHebrewFinalLettersDetailed('מנכ״ל ותנ״כ').text).toBe('מנכ״ל ותנ״ך');
  });

  it('reports final-letter normalization through the LK audit result', () => {
    const result = applyLoshonKodeshReplacementsDetailed('שלומ שלומ');

    expect(result.text).toBe('שלום שלום');
    expect(result.applied).toContainEqual({
      from: 'שלומ',
      to: 'שלום',
      category: 'general',
      source: 'orthography',
      count: 2,
    });
  });

  it('enforces every מנצפך pair in final and medial positions', () => {
    const pairs = [
      ['כ', 'ך'],
      ['מ', 'ם'],
      ['נ', 'ן'],
      ['פ', 'ף'],
      ['צ', 'ץ'],
    ] as const;

    for (const [medial, final] of pairs) {
      expect(normalizeHebrewFinalLettersDetailed(`אב${medial}`).text).toBe(`אב${final}`);
      expect(normalizeHebrewFinalLettersDetailed(`א${final}ב`).text).toBe(`א${medial}ב`);
      expect(normalizeHebrewFinalLettersDetailed(`${final}אב`).text).toBe(`${medial}אב`);
      expect(normalizeHebrewFinalLettersDetailed(`אב${final}`).text).toBe(`אב${final}`);
    }
  });
});
