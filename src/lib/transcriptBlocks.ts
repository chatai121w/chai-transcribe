export type TranscriptWord = { word: string };

export type SyntheticWordTiming = TranscriptWord & {
  start: number;
  end: number;
};

/**
 * Split transcript timings into stable render blocks, preferring sentence ends.
 * The live transcript and a locked snapshot must share this exact function.
 */
export function chunkTranscriptTimings<T extends TranscriptWord>(
  timings: readonly T[],
  target = 55,
  hardMax = 90,
): T[][] {
  if (!timings.length) return [];

  const safeTarget = Math.max(1, Math.floor(target));
  const safeHardMax = Math.max(safeTarget, Math.floor(hardMax));
  const blocks: T[][] = [];
  let current: T[] = [];

  for (const timing of timings) {
    current.push(timing);
    const endsSentence = /[.!?:]["'״׳)\]]?$/.test(timing.word);
    if ((current.length >= safeTarget && endsSentence) || current.length >= safeHardMax) {
      blocks.push(current);
      current = [];
    }
  }

  if (current.length) blocks.push(current);
  return blocks;
}

export function textToSyntheticTimings(text: string): SyntheticWordTiming[] {
  return text.trim().split(/\s+/).filter(Boolean).map((word, index) => ({
    word,
    start: index,
    end: index + 1,
  }));
}

export function chunkTranscriptText(text: string, target = 55, hardMax = 90): SyntheticWordTiming[][] {
  return chunkTranscriptTimings(textToSyntheticTimings(text), target, hardMax);
}
