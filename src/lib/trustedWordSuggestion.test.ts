import { describe, expect, it } from 'vitest';
import { getTrustedWordSuggestion } from './trustedWordSuggestion';

describe('getTrustedWordSuggestion', () => {
  it('trusts a user-approved dictionary replacement', () => {
    const result = getTrustedWordSuggestion([{ text: 'מיסודות', source: 'dictionary', score: 0.99 }]);
    expect(result?.text).toBe('מיסודות');
  });

  it('rejects weak learned and similarity suggestions', () => {
    expect(getTrustedWordSuggestion([{ text: 'בבא', source: 'learned', score: 0.75 }])).toBeNull();
    expect(getTrustedWordSuggestion([{ text: 'בבא', source: 'similar', score: 0.9 }])).toBeNull();
  });

  it('rejects conflicting strong answers', () => {
    expect(getTrustedWordSuggestion([
      { text: 'בבא', source: 'dictionary', score: 0.99 },
      { text: 'בבה', source: 'learned', score: 0.9 },
    ])).toBeNull();
  });
});
