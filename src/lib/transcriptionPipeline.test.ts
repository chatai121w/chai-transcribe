import { describe, expect, it } from 'vitest';
import { comparePipelineResults, type PipelineRunResult } from './transcriptionPipeline';

const result = (wer: number, cer: number, termRecall: number): PipelineRunResult => ({
  variant: 'baseline',
  experimentId: 'exp',
  recordingFingerprint: 'fp',
  rawText: '',
  text: '',
  engine: 'local-server',
  engineLabel: 'Local CUDA',
  wordTimings: [],
  elapsedMs: 1,
  appliedKnowledge: 0,
  metrics: { wer, cer, orthographicWer: wer, orthographicCer: cer, termRecall, lenRatio: 1 },
});

describe('comparePipelineResults', () => {
  it('accepts an improvement only when no tracked metric regresses', () => {
    const comparison = comparePipelineResults(result(0.3, 0.2, 0.7), result(0.2, 0.15, 0.8));
    expect(comparison?.verdict).toBe('improvement');
  });

  it('flags a terminology regression even when WER improves', () => {
    const comparison = comparePipelineResults(result(0.3, 0.2, 0.8), result(0.2, 0.15, 0.7));
    expect(comparison?.verdict).toBe('regression');
  });
});

