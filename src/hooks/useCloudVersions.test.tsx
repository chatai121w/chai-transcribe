import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insertPayload: vi.fn(),
  localPut: vi.fn(),
  localDelete: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/lib/localDb', () => ({
  isDbAvailable: vi.fn().mockResolvedValue(true),
  db: {
    versions: {
      put: mocks.localPut,
      delete: mocks.localDelete,
    },
  },
}));

vi.mock('@/lib/debugLogger', () => ({
  debugLog: {
    info: vi.fn(),
    warn: mocks.warn,
    error: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'ai_usage_events') {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.gte = () => chain;
        chain.order = () => chain;
        chain.limit = async () => ({ data: [] });
        return chain;
      }
      return {
        insert: (payload: Record<string, unknown>) => {
          mocks.insertPayload(payload);
          return {
            select: () => ({
              single: async () => ({
                data: {
                  ...payload,
                  id: 'cloud-version-1',
                  created_at: '2026-09-01T00:00:00.000Z',
                  word_count: 2,
                },
                error: null,
              }),
            }),
          };
        },
      };
    },
  },
}));

import { useCloudVersions } from './useCloudVersions';

describe('useCloudVersions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localPut.mockRejectedValue(new Error('IndexedDB is closed'));
    mocks.localDelete.mockResolvedValue(undefined);
  });

  it('continues saving to Supabase when the local version cache fails', async () => {
    const { result } = renderHook(() => useCloudVersions(null));
    let saved: { id?: string } | null = null;

    await act(async () => {
      saved = await result.current.saveVersion('טקסט מתוקן', 'manual', null, 'תיקון ידני', {
        transcriptId: 'transcript-1',
      });
    });

    expect(mocks.insertPayload).toHaveBeenCalledWith(expect.objectContaining({
      transcript_id: 'transcript-1',
      text: 'טקסט מתוקן',
    }));
    expect(saved?.id).toBe('cloud-version-1');
    expect(mocks.warn).toHaveBeenCalledWith(
      'Versions',
      'Local version cache failed; continuing with cloud save',
      'IndexedDB is closed',
    );
  });
});
