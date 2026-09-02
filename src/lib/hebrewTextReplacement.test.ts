import { describe, expect, it } from 'vitest';
import { replaceWholeTextOccurrences } from './hebrewTextReplacement';

describe('replaceWholeTextOccurrences', () => {
  it('replaces phrases across flexible whitespace', () => {
    const result = replaceWholeTextOccurrences('מסכת  בבא\nבתרא', 'בבא בתרא', 'בבא קמא');
    expect(result).toMatchObject({ text: 'מסכת  בבא קמא', count: 1 });
    expect(result.occurrences).toEqual([expect.objectContaining({
      before: 'בבא\nבתרא',
      after: 'בבא קמא',
      inputStart: 6,
      outputStart: 6,
    })]);
  });

  it('preserves punctuation around the replacement', () => {
    const result = replaceWholeTextOccurrences('אמר: בברא, ושוב בברא.', 'בברא', 'בבא בתרא');
    expect(result).toMatchObject({ text: 'אמר: בבא בתרא, ושוב בבא בתרא.', count: 2 });
    expect(result.occurrences).toHaveLength(2);
    expect(result.occurrences.map(item => item.before)).toEqual(['בברא', 'בברא']);
  });

  it('preserves a common Hebrew prefix attached to the source word', () => {
    expect(replaceWholeTextOccurrences('נסענו לירושליים', 'ירושליים', 'ירושלים')).toMatchObject({
      text: 'נסענו לירושלים',
      count: 1,
      occurrences: [expect.objectContaining({ before: 'ירושליים', after: 'ירושלים', inputStart: 7 })],
    });
  });

  it('does not treat nun as a removable prefix', () => {
    expect(replaceWholeTextOccurrences('העולם נברא', 'ברא', 'בבא')).toEqual({
      text: 'העולם נברא',
      count: 0,
      occurrences: [],
    });
  });
});
