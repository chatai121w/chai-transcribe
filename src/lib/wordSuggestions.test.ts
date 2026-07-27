import { describe, expect, it } from 'vitest';
import { uniqueWordSuggestions } from './wordSuggestions';

describe('uniqueWordSuggestions', () => {
  it('deduplicates identical suggestions from local and AI sources', () => {
    expect(uniqueWordSuggestions(['מיסודות', 'מיסודות', 'מיסודות'], 'מיסודס')).toEqual(['מיסודות']);
  });

  it('normalizes invisible formatting and surrounding punctuation', () => {
    expect(uniqueWordSuggestions([' בבא ', '\u200Fבבא', 'בבא,'], 'בברא')).toEqual(['בבא']);
  });

  it('removes a suggestion that is the original word', () => {
    expect(uniqueWordSuggestions(['חוקיך', 'חוקייך'], 'חוקיך,')).toEqual(['חוקייך']);
  });
});
