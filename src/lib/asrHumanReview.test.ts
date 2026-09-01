import { describe, expect, it } from 'vitest';
import { buildAsrReviewUnits, mergeAsrReviewSelection, reviewChoiceText } from './asrHumanReview';

describe('ASR human review', () => {
  it('reuses adjudication alignment and keeps each equal word selectable', () => {
    const units = buildAsrReviewUnits(
      'אמר רבי עקיבא היום',
      'אמר רבי עקיבה היום',
      'אמר רבי עקיבא היום',
      [],
      [
        { word: 'אמר', start: 0, end: 0.4 },
        { word: 'רבי', start: 0.4, end: 0.8 },
        { word: 'עקיבא', start: 0.8, end: 1.3 },
        { word: 'היום', start: 1.3, end: 1.8 },
      ],
    );

    expect(units).toHaveLength(4);
    expect(units[2]).toMatchObject({ sourceText: 'עקיבא ', baselineText: 'עקיבה ', candidateText: 'עקיבא ', start: 0.8, end: 1.3 });
  });

  it('merges a contiguous phrase and resolves source, engines, or custom text', () => {
    const units = buildAsrReviewUnits('אמר רבי עקיבא', 'אמר רבי עקיבה', 'אמר רב עקיבא');
    const selection = mergeAsrReviewSelection(units, [units[1].id, units[2].id]);

    expect(selection.sourceText).toBe('רבי עקיבא');
    expect(reviewChoiceText('source', selection, '')).toBe('רבי עקיבא');
    expect(reviewChoiceText('custom', selection, 'רבי עקיבא זצ״ל')).toBe('רבי עקיבא זצ״ל');
  });
});
