import { beforeEach, describe, expect, it, vi } from 'vitest';

const insert = vi.fn(async () => ({ error: null }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })) },
    from: vi.fn(() => ({ insert })),
  },
}));

import { clearPipelineEvents, listPipelineEvents, logKnowledgeTrace, logPipelineEvent } from './pipelineAudit';
import { createTraceStage } from './transcriptionTrace';

describe('pipeline audit trail', () => {
  beforeEach(() => {
    localStorage.clear();
    insert.mockClear();
  });

  it('persists structured events by experiment and mirrors them to the cloud', async () => {
    await logPipelineEvent({
      experimentId: 'experiment-a',
      stage: 'metrics',
      level: 'success',
      eventType: 'metrics-calculated',
      message: 'המדדים חושבו',
      details: { wer: 0.12, reason: 'השוואה מול טקסט אמת' },
    });
    await logPipelineEvent({
      experimentId: 'experiment-b',
      stage: 'complete',
      level: 'error',
      eventType: 'run-failed',
      message: 'הריצה נכשלה',
      details: { error: 'timeout' },
    });

    expect(listPipelineEvents('experiment-a')).toHaveLength(1);
    expect(listPipelineEvents('experiment-a')[0]).toMatchObject({
      stage: 'metrics',
      eventType: 'metrics-calculated',
      details: { wer: 0.12 },
    });
    expect(insert).toHaveBeenCalledTimes(2);

    clearPipelineEvents('experiment-a');
    expect(listPipelineEvents('experiment-a')).toEqual([]);
    expect(listPipelineEvents('experiment-b')).toHaveLength(1);
  });

  it('persists a replayable knowledge trace with its exact UI surface and source code', async () => {
    const stage = createTraceStage({
      index: 0,
      id: 'orthography-pre',
      label: 'בדיקת מנצפך',
      enabled: true,
      source: {
        system: 'mandatory-hebrew-orthography',
        file: 'src/lib/loshonKodesh.ts',
        function: 'normalizeHebrewFinalLettersDetailed',
      },
      inputText: 'שלום',
      outputText: 'שלום',
    });

    const events = await logKnowledgeTrace({
      experimentId: 'trace-run',
      surface: 'transcribe',
      engine: 'Local CUDA',
      initialText: 'שלום',
      knowledge: {
        trace: [stage],
        traceValidationErrors: [],
        traceOverlaps: [],
        totalApplied: 0,
        counts: { definitive: 0, learned: 0, profile: 0, vocabulary: 0, loshonKodesh: 0, orthography: 0, ai: 0 },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventType: 'knowledge-trace-stage',
      details: {
        surface: 'transcribe',
        engine: 'Local CUDA',
        stage: {
          source: {
            file: 'src/lib/loshonKodesh.ts',
            function: 'normalizeHebrewFinalLettersDetailed',
          },
        },
      },
    });
    expect(events[1]).toMatchObject({
      eventType: 'knowledge-trace-valid',
      details: { traceStageCount: 1, validationErrors: [] },
    });
    expect(insert).toHaveBeenCalledTimes(2);
  });

  it('never blocks the transcription flow when local audit storage is unavailable', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(logPipelineEvent({
      experimentId: 'storage-failure',
      stage: 'knowledge',
      level: 'success',
      eventType: 'trace-ready',
      message: 'trace ready',
      details: { surface: 'transcribe' },
    })).resolves.toMatchObject({ eventType: 'trace-ready' });
    expect(insert).toHaveBeenCalledTimes(1);

    setItem.mockRestore();
    warn.mockRestore();
  });
});
