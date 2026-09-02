import { describe, expect, it } from 'vitest';
import {
  buildFallbackPracticeScript,
  cleanGeneratedPracticeScript,
  findMissingPracticeTerms,
  splitPracticeTerms,
} from './termPracticeScript';

describe('term practice script', () => {
  it('keeps multi-word concepts separate when comma or newline delimited', () => {
    expect(splitPracticeTerms('ארוממך, אשרי יושבי ביתך\nתהילה לדוד, ארוממך')).toEqual([
      'ארוממך',
      'אשרי יושבי ביתך',
      'תהילה לדוד',
    ]);
  });

  it('creates contextual fallback text instead of copying the term list', () => {
    const terms = ['ארוממך', 'אשרי יושבי ביתך'];
    const script = buildFallbackPracticeScript(terms, 'natural');

    expect(script).not.toBe(terms.join(', '));
    expect(findMissingPracticeTerms(script, terms)).toEqual([]);
  });

  it('connects terminology targets into one meaningful reading sentence', () => {
    const terms = ['גמרא במסכת קידושין', 'דיני קידושין ושליחות', 'הנתיבות', 'קצות החושן'];
    const script = buildFallbackPracticeScript(terms, 'terms');

    expect(script).toBe('בשיעור נעסוק בגמרא במסכת קידושין, נעמיק בדיני קידושין ושליחות, ונבחן את הקשר בין הנתיבות לבין קצות החושן.');
    expect(script).not.toContain('כעת אקרא את המושג');
    expect(findMissingPracticeTerms(script, terms)).toEqual([]);
  });

  it('reports a term omitted by generated text and ignores Hebrew niqqud', () => {
    expect(findMissingPracticeTerms('אֲרוֹמִמְךָ אלוהי המלך', ['ארוממך', 'תהילה לדוד'])).toEqual(['תהילה לדוד']);
  });

  it('removes model code fences and wrapping quotation marks', () => {
    expect(cleanGeneratedPracticeScript('```text\n"ארוממך אלוהי המלך"\n```')).toBe('ארוממך אלוהי המלך');
  });
});
