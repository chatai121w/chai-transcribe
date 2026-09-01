import { beforeEach, describe, expect, it, vi } from 'vitest';

const insert = vi.fn(async () => ({ error: null }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })) },
    from: vi.fn(() => ({ insert })),
  },
}));

import { clearPipelineEvents, listPipelineEvents, logPipelineEvent } from './pipelineAudit';

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
});
