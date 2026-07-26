import { describe, expect, it } from 'vitest';
import { alignEditedToWhisper, findActiveWordIndex } from './whisperAlignment';

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
});
