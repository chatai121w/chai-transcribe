import { describe, expect, it } from 'vitest';
import { evaluateLearningRegression } from './learningRegression';

describe('evaluateLearningRegression', () => {
  it('separates improvements from regressions', () => {
    const result = evaluateLearningRegression(
      'פדיון מעשר שני הוא מצווה',
      'פדיון מעשה שני הוא מצווה',
      'פדיון מעשר שני היא מצווה',
    );

    expect(result.improved).toBe(1);
    expect(result.regressions).toBe(1);
    expect(result.netImprovement).toBe(0);
    expect(result.words.find((word) => word.reference === 'מעשר')?.status).toBe('improved');
    expect(result.words.find((word) => word.reference === 'הוא')?.status).toBe('regression');
  });

  it('reports a positive net improvement when candidate reduces WER', () => {
    const result = evaluateLearningRegression('רבי יוחנן וריש לקיש', 'יוחנן ונשלוקש', 'רבי יוחנן וריש לקיש');
    expect(result.candidate.wer).toBe(0);
    expect(result.baseline.wer).toBeGreaterThan(0);
    expect(result.netImprovement).toBeGreaterThan(0);
    expect(result.regressions).toBe(0);
  });
});
