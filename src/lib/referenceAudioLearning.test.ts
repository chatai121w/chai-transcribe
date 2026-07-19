import { describe, expect, it, vi } from 'vitest';
import { buildReferenceSegments, referenceWordErrorRate } from '@/lib/referenceAudioLearning';

describe('reference audio learning', () => {
  it('calculates word error rate after removing Hebrew marks and punctuation', () => {
    expect(referenceWordErrorRate('בָּרְכִי נפשי.', 'ברכי נפשי')).toBe(0);
    expect(referenceWordErrorRate('ברכי נפשי', 'ברכי רוחי')).toBe(0.5);
  });

  it('builds bounded, ordered segments from aligned timings', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'segment-id' });
    const words = Array.from({ length: 20 }, (_, index) => `מילה${index}`);
    const timings = words.map((word, index) => ({ word, start: index, end: index + 0.8 }));
    const segments = buildReferenceSegments(words.join(' '), timings);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.end > segment.start && segment.end - segment.start <= 20)).toBe(true);
    expect(segments.map((segment) => segment.text).join(' ')).toBe(words.join(' '));
    vi.unstubAllGlobals();
  });
});
