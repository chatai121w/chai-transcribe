import { alignEditedToWhisper } from '@/lib/whisperAlignment';
import type { WordTiming } from '@/components/SyncAudioPlayer';

export interface ReferenceSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface ReferenceSegmentQuality {
  safe: boolean;
  wordsPerSecond: number;
  reason?: string;
}

export const cleanReferenceText = (text: string) => text
  .replace(/\([^)]*\)\s*\[([^\]]+)\]/g, '$1')
  .replace(/\{[פס]\}/g, ' ')
  .replace(/&(nbsp|thinsp);/gi, ' ')
  .replace(/&#(?:160|8201);/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function assessReferenceSegment(segment: ReferenceSegment): ReferenceSegmentQuality {
  const duration = segment.end - segment.start;
  const wordCount = normalizeReferenceWords(segment.text).length;
  const wordsPerSecond = duration > 0 ? wordCount / duration : Number.POSITIVE_INFINITY;
  if (duration < 2) return { safe: false, wordsPerSecond, reason: 'הקטע קצר מדי' };
  if (duration > 14.7) return { safe: false, wordsPerSecond, reason: 'הקטע ארוך מדי' };
  if (wordsPerSecond < 0.35) return { safe: false, wordsPerSecond, reason: 'מעט מדי מילים ביחס לאורך' };
  if (wordsPerSecond > 2.8) return { safe: false, wordsPerSecond, reason: 'יותר מדי מילים ביחס לאורך' };
  return { safe: true, wordsPerSecond };
}

export const normalizeReferenceWords = (text: string) => text
  .replace(/[\u0591-\u05C7]/g, '')
  .replace(/[^\u05D0-\u05EA\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .split(' ')
  .filter(Boolean);

export function referenceWordErrorRate(reference: string, hypothesis: string): number {
  const expected = normalizeReferenceWords(reference);
  const actual = normalizeReferenceWords(hypothesis);
  if (!expected.length) return 0;
  let previous = Array.from({ length: actual.length + 1 }, (_, index) => index);
  expected.forEach((word, expectedIndex) => {
    const current = [expectedIndex + 1];
    actual.forEach((actualWord, actualIndex) => {
      current[actualIndex + 1] = Math.min(
        current[actualIndex] + 1,
        previous[actualIndex + 1] + 1,
        previous[actualIndex] + (word === actualWord ? 0 : 1),
      );
    });
    previous = current;
  });
  return previous[actual.length] / expected.length;
}

export function buildReferenceSegments(reference: string, whisperTimings: WordTiming[]): ReferenceSegment[] {
  const words = cleanReferenceText(reference).split(/\s+/).filter(Boolean);
  const aligned = alignEditedToWhisper(words, whisperTimings);
  const segments: ReferenceSegment[] = [];
  let startIndex = 0;
  while (startIndex < aligned.length) {
    let endIndex = startIndex;
    while (endIndex < aligned.length - 1) {
      const duration = aligned[endIndex].end - aligned[startIndex].start;
      const punctuationBoundary = /[.!?׃:]$/.test(words[endIndex]);
      if (duration >= 7 && punctuationBoundary) break;
      const nextDuration = aligned[endIndex + 1].end - aligned[startIndex].start;
      if (nextDuration > 14) break;
      endIndex += 1;
    }
    const start = Math.max(0, aligned[startIndex].start - 0.35);
    const end = aligned[endIndex].end + 0.35;
    segments.push({ id: crypto.randomUUID(), start, end, text: words.slice(startIndex, endIndex + 1).join(' ') });
    startIndex = endIndex + 1;
  }
  return segments;
}
