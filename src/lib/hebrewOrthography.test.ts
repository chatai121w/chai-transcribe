import { describe, expect, it } from 'vitest';
import { normalizeHebrewFinalLettersDetailed } from './hebrewOrthography';

describe('canonical Hebrew orthography', () => {
  it('uses final forms only at the end of every Hebrew word part', () => {
    const result = normalizeHebrewFinalLettersDetailed('שלומ םלכ פנימ צדיק כתר');
    expect(result.text).toBe('שלום מלך פנים צדיק כתר');
    expect(result.traceOperations.map(operation => operation.ruleId)).toEqual([
      'final-letter-misplaced',
      'final-letter-required',
    ]);
  });

  it('normalizes all five final letters at word end and reverses them in the middle', () => {
    expect(normalizeHebrewFinalLettersDetailed('מלכ שלומ מאזנ אלפ ארצ').text)
      .toBe('מלך שלום מאזן אלף ארץ');
    expect(normalizeHebrewFinalLettersDetailed('ךתב םילה ןביא ףנים ץדיק').text)
      .toBe('כתב מילה נביא פנים צדיק');
  });

  it('handles niqqud, punctuation and maqaf without losing characters', () => {
    expect(normalizeHebrewFinalLettersDetailed('שָׁלוֹמ, מלכ־שלומ').text)
      .toBe('שָׁלוֹם, מלך־שלום');
  });

  it('is idempotent at the final gate', () => {
    const once = normalizeHebrewFinalLettersDetailed('שלום מלך פנים ארץ').text;
    const twice = normalizeHebrewFinalLettersDetailed(once);
    expect(twice.text).toBe(once);
    expect(twice.appliedCount).toBe(0);
  });
});
