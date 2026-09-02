import { describe, expect, it } from 'vitest';
import {
  computeOrthographicCER,
  computeOrthographicWER,
  computeTermRecall,
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

  it('measures multi-word target terms as complete phrases', () => {
    expect(computeTermRecall(
      'אמר רבי עקיבא דבר חשוב ושוב אמר רבי עקיבא',
      'אמר רבי עקיבה דבר חשוב ושוב אמר רבי עקיבא',
      ['רבי עקיבא'],
    )).toEqual({ recall: 0.5, total: 2, matched: 1, missed: ['רבי עקיבא'] });
  });

  it('does not double-count duplicate target terms', () => {
    expect(computeTermRecall('מסכת בבא קמא', 'מסכת בבא קמא', ['מסכת בבא קמא', 'מסכת בבא קמא']).recall).toBe(1);
  });
});
