import { describe, expect, it } from 'vitest';
import { buildAsrAudioComparisonPlan } from './asrAudioPreprocessing';

describe('ASR audio preprocessing plan', () => {
  it('keeps preprocessing off by default', () => {
    expect(buildAsrAudioComparisonPlan('off')).toEqual({
      baselineInput: 'original',
      candidateInput: 'original',
      isolateAudioChange: false,
    });
  });

  it('reuses one processed input for model or knowledge comparisons', () => {
    expect(buildAsrAudioComparisonPlan('shared')).toEqual({
      baselineInput: 'processed',
      candidateInput: 'processed',
      isolateAudioChange: false,
    });
  });

  it('isolates audio enhancement when comparing original with processed', () => {
    expect(buildAsrAudioComparisonPlan('compare')).toEqual({
      baselineInput: 'original',
      candidateInput: 'processed',
      isolateAudioChange: true,
    });
  });
});
