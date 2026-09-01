import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { maybeSingle, setEncryptedKey } = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  setEncryptedKey: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle })),
      })),
    })),
  },
}));

vi.mock('@/lib/keyCrypto', () => ({ setEncryptedKey }));
vi.mock('@/lib/debugLogger', () => ({ debugLog: { info: vi.fn(), error: vi.fn() } }));

import { recoverGeminiKeyFromCloud } from '@/lib/cloudKeyFallback';

describe('Gemini cloud key recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('prefers the dedicated Gemini key and enables the personal route', async () => {
    maybeSingle.mockResolvedValue({ data: { gemini_key: 'gemini-key', google_key: 'google-key' } });

    await expect(recoverGeminiKeyFromCloud()).resolves.toBe('gemini-key');
    expect(localStorage.getItem('gemini_api_key')).toBe('gemini-key');
    expect(localStorage.getItem('use_personal_gemini')).toBe('1');
  });

  it('reuses the existing Google key when no dedicated Gemini key exists', async () => {
    maybeSingle.mockResolvedValue({ data: { gemini_key: null, google_key: 'shared-google-key' } });

    await expect(recoverGeminiKeyFromCloud()).resolves.toBe('shared-google-key');
    expect(localStorage.getItem('gemini_api_key')).toBe('shared-google-key');
  });
});
