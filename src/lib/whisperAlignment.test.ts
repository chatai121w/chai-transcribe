import { describe, expect, it } from 'vitest';
import { alignEditedToWhisper, findActiveWordIndex, fitTimingsToDuration } from './whisperAlignment';

describe('word timing synchronization', () => {
  const timings = [
    { word: 'שלום', start: 0.2, end: 0.65 },
    { word: 'עולם', start: 0.9, end: 1.3 },
    { word: 'הבא', start: 1.4, end: 1.7 },
  ];

  it('uses word boundaries and leaves real silences blank', () => {
    expect(findActiveWordIndex(timings, 0.4)).toBe(0);
    expect(findActiveWordIndex(timings, 0.78)).toBe(-1);
    expect(findActiveWordIndex(timings, 1.05)).toBe(1);
    expect(findActiveWordIndex(timings, 2)).toBe(-1);
  });

  it('preserves Whisper anchors rather than distributing the file uniformly', () => {
    const aligned = alignEditedToWhisper(['שלום', 'לכל', 'עולם', 'הבא'], timings);
    expect(aligned[0]).toMatchObject({ start: 0.2, end: 0.65 });
    expect(aligned[2]).toMatchObject({ start: 0.9, end: 1.3 });
    expect(aligned[3]).toMatchObject({ start: 1.4, end: 1.7 });
    expect(aligned[1].start).toBeGreaterThanOrEqual(0.65);
    expect(aligned[1].end).toBeLessThanOrEqual(0.9);
  });

  it('makes the final transcript word end with the audio', () => {
    const fitted = fitTimingsToDuration([
      { word: 'אחד', start: 1, end: 2 },
      { word: 'שניים', start: 2.5, end: 4 },
    ], 6);

    expect(fitted[0].start).toBe(1);
    expect(fitted[1].end).toBe(6);
    expect(fitted[1].start).toBeGreaterThanOrEqual(fitted[0].end);
  });

  it('does not change timings when duration is unavailable', () => {
    const unchanged = [{ word: 'אחד', start: 0, end: 1 }];
    expect(fitTimingsToDuration(unchanged, 0)).toBe(unchanged);
  });
});
