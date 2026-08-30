import { describe, expect, it } from 'vitest';
import { buildApprovedAsrMetadata } from './asrDatasetMetadata';

describe('buildApprovedAsrMetadata', () => {
  it('creates a Gold record with one recording group and deduplicated teachers', () => {
    const metadata = buildApprovedAsrMetadata({
      recordingFingerprint: 'recording-123',
      sourceKind: 'tanakh',
      sourceRef: 'Psalms.1',
      sourceLabel: 'תהילים א',
      teacherEngines: ['gemini:flash', 'local:ivrit', 'gemini:flash'],
      approvedAt: '2026-08-30T00:00:00.000Z',
    });

    expect(metadata.qualityTier).toBe('gold');
    expect(metadata.labelSource).toBe('human-approved');
    expect(metadata.groupId).toBe('recording-123');
    expect(metadata.teacherEngines).toBe('gemini:flash|local:ivrit');
  });

  it('requires a recording identity so train/eval cannot leak across clips', () => {
    expect(() => buildApprovedAsrMetadata({
      recordingFingerprint: ' ', sourceKind: 'text', sourceRef: '', sourceLabel: '', teacherEngines: [],
    })).toThrow('recording fingerprint is required');
  });
});
