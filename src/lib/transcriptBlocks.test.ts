import { describe, expect, it } from 'vitest';
import { alignedLineCount, buildLineAlignment } from './lineAlignment';
import { chunkTranscriptText, chunkTranscriptTimings, textToSyntheticTimings } from './transcriptBlocks';

const blockKeys = (blocks: ReadonlyArray<ReadonlyArray<{ word: string }>>) => (
  blocks.map((block) => block.map((timing) => timing.word).join(' ').trim())
);

describe('transcript blocks', () => {
  it('uses identical boundaries for a live transcript and its locked snapshot', () => {
    const words = Array.from({ length: 5_619 }, (_, index) => (
      index % 60 === 59 ? `word-${index}.` : `word-${index}`
    ));
    const text = words.join(' ');

    const live = chunkTranscriptTimings(textToSyntheticTimings(text));
    const snapshot = chunkTranscriptText(text);

    expect(live.length).toBeGreaterThan(60);
    expect(blockKeys(snapshot)).toEqual(blockKeys(live));
  });

  it('keeps unchanged blocks aligned when edits are far apart', () => {
    const words = Array.from({ length: 5_619 }, (_, index) => (
      index % 60 === 59 ? `word-${index}.` : `word-${index}`
    ));
    const before = words.join(' ');
    const afterWords = [...words];
    afterWords[80] = 'edited-near-start';
    afterWords[5_500] = 'edited-near-end';

    const beforeBlocks = blockKeys(chunkTranscriptText(before));
    const afterBlocks = blockKeys(chunkTranscriptText(afterWords.join(' ')));
    const matches = alignedLineCount(buildLineAlignment(beforeBlocks, afterBlocks, 1));

    expect(matches).toBe(beforeBlocks.length - 2);
  });
});
