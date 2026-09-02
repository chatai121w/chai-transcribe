import { describe, expect, it, vi } from 'vitest';
import { assessReferenceSegment, buildReferenceSegments, cleanReferenceText, referenceWordErrorRate } from '@/lib/referenceAudioLearning';

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

  it('does not drop reference words when timings contain a large recognition gap', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'segment-id' });
    const words = ['אחד', 'שנים', 'שלש', 'ארבע', 'חמש'];
    const timings = [
      { word: 'אחד', start: 0, end: 1 },
      { word: 'שנים', start: 2, end: 3 },
      { word: 'שלש', start: 30, end: 31 },
      { word: 'ארבע', start: 32, end: 33 },
      { word: 'חמש', start: 34, end: 35 },
    ];
    const segments = buildReferenceSegments(words.join(' '), timings);
    expect(segments.map((segment) => segment.text).join(' ')).toBe(words.join(' '));
    expect(segments.every((segment) => segment.end - segment.start <= 14.7)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('removes Sefaria markup and keeps the read form of textual variants', () => {
    expect(cleanReferenceText('מילה&nbsp; {פ} (וידעו) [וידעי] עדתיך')).toBe('מילה וידעי עדתיך');
  });

  it('rejects implausibly dense training segments', () => {
    expect(assessReferenceSegment({
      id: 'dense', start: 0, end: 5, text: Array.from({ length: 20 }, () => 'מילה').join(' '),
    }).safe).toBe(false);
    expect(assessReferenceSegment({ id: 'normal', start: 0, end: 8, text: 'אחת שתים שלש ארבע חמש שש שבע' }).safe).toBe(true);
  });

  it('allows fast verified speech only when the caller opts into the manual-review threshold', () => {
    const fast = {
      id: 'fast', start: 0, end: 10, text: Array.from({ length: 34 }, () => 'מילה').join(' '),
    };
    expect(assessReferenceSegment(fast).safe).toBe(false);
    expect(assessReferenceSegment(fast, { maxWordsPerSecond: 4 }).safe).toBe(true);
  });
});
