import { describe, expect, it } from 'vitest';
import {
  computeOrthographicCER,
  computeOrthographicWER,
  computeWER,
  ORTHOGRAPHIC_NORMALIZE_OPTIONS,
  wordDiff,
} from './asrMetrics';

describe('Hebrew ASR metrics', () => {
  it('keeps the legacy normalized score while exposing final-letter errors', () => {
    expect(computeWER('חוקיך', 'חוקיכ').wer).toBe(0);
    expect(computeOrthographicWER('חוקיך', 'חוקיכ').wer).toBe(1);
    expect(computeOrthographicCER('חוקיך', 'חוקיכ').cer).toBeGreaterThan(0);
  });

  it('uses strict spelling for correction evidence', () => {
    expect(wordDiff('מצוותיך', 'מצוותיכ')).toEqual([
      { type: 'eq', ref: 'מצוותיכ', hyp: 'מצוותיכ' },
    ]);
    expect(wordDiff('מצוותיך', 'מצוותיכ', ORTHOGRAPHIC_NORMALIZE_OPTIONS)).toEqual([
      { type: 'sub', ref: 'מצוותיך', hyp: 'מצוותיכ' },
    ]);
  });
});
