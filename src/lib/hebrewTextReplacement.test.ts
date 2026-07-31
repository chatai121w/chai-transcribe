import { describe, expect, it } from 'vitest';
import { replaceWholeTextOccurrences } from './hebrewTextReplacement';

describe('replaceWholeTextOccurrences', () => {
  it('replaces phrases across flexible whitespace', () => {
    const result = replaceWholeTextOccurrences('מסכת  בבא\nבתרא', 'בבא בתרא', 'בבא קמא');
    expect(result).toEqual({ text: 'מסכת  בבא קמא', count: 1 });
  });

  it('preserves punctuation around the replacement', () => {
    const result = replaceWholeTextOccurrences('אמר: בברא, ושוב בברא.', 'בברא', 'בבא בתרא');
    expect(result).toEqual({ text: 'אמר: בבא בתרא, ושוב בבא בתרא.', count: 2 });
  });

  it('preserves a common Hebrew prefix attached to the source word', () => {
    expect(replaceWholeTextOccurrences('נסענו לירושליים', 'ירושליים', 'ירושלים')).toEqual({
      text: 'נסענו לירושלים',
      count: 1,
    });
  });

  it('does not treat nun as a removable prefix', () => {
    expect(replaceWholeTextOccurrences('העולם נברא', 'ברא', 'בבא')).toEqual({
      text: 'העולם נברא',
      count: 0,
    });
  });
});
