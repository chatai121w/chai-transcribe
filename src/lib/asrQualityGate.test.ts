import { describe, expect, it } from 'vitest';
import { evaluateAsrQualityGate } from './asrQualityGate';

describe('evaluateAsrQualityGate', () => {
  it('reports weighted improvement across a fixed evaluation set', () => {
    const result = evaluateAsrQualityGate([
      {
        id: 'long-recording',
        reference: 'רב האי גאון אמר בבא בתרא הלכה למעשה',
        baseline: 'האיגון אמר בברבטרה הלכה למעשה',
        candidate: 'רב האי גאון אמר בבא בתרא הלכה למעשה',
      },
      {
        id: 'short-recording',
        reference: 'חוקיך מצוותיך',
        baseline: 'חוקיכ מצוותיכ',
        candidate: 'חוקיך מצוותיך',
      },
    ]);

    expect(result.passed).toBe(true);
    expect(result.improvedSamples).toBe(2);
    expect(result.regressedSamples).toEqual([]);
    expect(result.orthographicWerImprovement).toBeGreaterThan(0);
    expect(result.baseline.referenceWords).toBe(10);
  });

  it('fails when one recording regresses even if the aggregate score improves', () => {
    const result = evaluateAsrQualityGate([
      {
        id: 'large-improvement',
        reference: 'רב האי גאון אמר בבא בתרא הלכה למעשה',
        baseline: 'שגיאה שגיאה שגיאה שגיאה שגיאה שגיאה שגיאה שגיאה',
        candidate: 'רב האי גאון אמר בבא בתרא הלכה למעשה',
      },
      {
        id: 'hidden-regression',
        reference: 'הוא אמר הלכה',
        baseline: 'הוא אמר הלכה',
        candidate: 'היא אמר הלכה',
      },
    ]);

    expect(result.werImprovement).toBeGreaterThan(0);
    expect(result.passed).toBe(false);
    expect(result.regressedSamples).toEqual(['hidden-regression']);
    expect(result.reasons).toContain('sample-regression');
  });

  it('fails on a final-letter regression hidden by normalized WER', () => {
    const result = evaluateAsrQualityGate([{
      id: 'final-letters',
      reference: 'חוקיך מצוותיך',
      baseline: 'חוקיך מצוותיך',
      candidate: 'חוקיכ מצוותיכ',
    }]);

    expect(result.baseline.wer).toBe(0);
    expect(result.candidate.wer).toBe(0);
    expect(result.candidate.orthographicWer).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('rejects an empty evaluation set', () => {
    const result = evaluateAsrQualityGate([]);
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('evaluation-set-empty');
  });
});
