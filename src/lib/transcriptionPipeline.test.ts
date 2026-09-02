import { describe, expect, it } from 'vitest';
import { comparePipelineResults, parseLocalTranscriptionStream, type PipelineRunResult } from './transcriptionPipeline';

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

describe('parseLocalTranscriptionStream', () => {
  it('uses the production SSE contract and prefers the final done payload', async () => {
    const response = new Response([
      'data: {"type":"info","duration":2,"model":"model-a","language":"he"}\n',
      'data: {"type":"segment","text":"שלומ","progress":50,"words":[{"word":"שלומ","start":0,"end":1}]}\n',
      'data: {"type":"done","text":"שלומ עולם","wordTimings":[{"word":"שלומ","start":0,"end":1},{"word":"עולם","start":1,"end":2}]}\n',
    ].join(''));

    const result = await parseLocalTranscriptionStream(response);
    expect(result.text).toBe('שלומ עולם');
    expect(result.wordTimings).toHaveLength(2);
    expect(result.model).toBe('model-a');
  });

  it('rejects an explicit stream error instead of returning a partial success', async () => {
    const response = new Response('data: {"type":"error","error":"failed"}\n');
    await expect(parseLocalTranscriptionStream(response)).rejects.toThrow('failed');
  });
});

