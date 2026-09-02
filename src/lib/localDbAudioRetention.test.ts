import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./recordingFingerprint', () => ({
  fingerprintFile: vi.fn(async (blob: Blob) => blob.size === 3 ? 'old-fingerprint' : 'new-fingerprint'),
}));

import { db, LAST_AUDIO_ALIAS, retainAudioBlob } from './localDb';

describe('retainAudioBlob', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('archives the legacy alias and stores the new recording plus active alias', async () => {
    const previous = {
      id: LAST_AUDIO_ALIAS,
      blob: new Blob(['old']),
      type: 'audio/wav',
      name: 'old.wav',
      saved_at: 1,
    };
    const writes: Array<{ id: string; name: string }> = [];
    vi.spyOn(db.audioBlobs, 'get').mockImplementation((async (id: string) => {
      if (id === LAST_AUDIO_ALIAS) return previous;
      return undefined;
    }) as never);
    vi.spyOn(db.audioBlobs, 'put').mockImplementation((async (record: { id: string; name: string }) => {
      writes.push({ id: record.id, name: record.name });
      return record.id;
    }) as never);
    vi.spyOn(db, 'transaction').mockImplementation((async (_mode, _table, scope) => scope()) as typeof db.transaction);

    const result = await retainAudioBlob(new Blob(['new-audio']), 'new.wav', 'audio/wav');

    expect(result).toEqual({ fingerprint: 'new-fingerprint', id: 'recording:new-fingerprint' });
    expect(writes).toEqual([
      { id: 'recording:old-fingerprint', name: 'old.wav' },
      { id: 'recording:new-fingerprint', name: 'new.wav' },
      { id: LAST_AUDIO_ALIAS, name: 'new.wav' },
    ]);
  });
});
