import { alignEditedToWhisper } from '@/lib/whisperAlignment';
import type { WordTiming } from '@/components/SyncAudioPlayer';

export interface ReferenceSegment {
  id: string;
  start: number;
  end: number;
  text: string;
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
  const words = reference.trim().split(/\s+/).filter(Boolean);
  const aligned = alignEditedToWhisper(words, whisperTimings);
  const segments: ReferenceSegment[] = [];
  let startIndex = 0;
  while (startIndex < aligned.length) {
    let endIndex = startIndex;
    while (endIndex < aligned.length - 1) {
      const duration = aligned[endIndex].end - aligned[startIndex].start;
      const punctuationBoundary = /[.!?׃:]$/.test(words[endIndex]);
      if ((duration >= 7 && punctuationBoundary) || duration >= 12) break;
      endIndex += 1;
    }
    const start = Math.max(0, aligned[startIndex].start - 0.35);
    const end = aligned[endIndex].end + 0.35;
    if (end - start >= 1.5 && end - start <= 20) {
      segments.push({ id: crypto.randomUUID(), start, end, text: words.slice(startIndex, endIndex + 1).join(' ') });
    }
    startIndex = endIndex + 1;
  }
  return segments;
}
