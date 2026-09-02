import { describe, expect, it } from 'vitest';
import { asrSampleSourceKind, asrSampleTypeTag, inferAsrSampleType } from './asrSampleType';

describe('ASR sample classification', () => {
  it('round-trips an explicit classification tag', () => {
    const tag = asrSampleTypeTag('term-reading');
    expect(inferAsrSampleType([tag], 'unrelated.wav')).toBe('term-reading');
    expect(asrSampleSourceKind('term-reading')).toBe('transcription-lab:term-reading');
  });

  it('infers recordings created by the existing recorder without overriding explicit tags', () => {
    expect(inferAsrSampleType([], 'torah-natural-speech-123.webm')).toBe('natural-speech');
    expect(inferAsrSampleType([], 'torah-terms-123.webm')).toBe('term-reading');
    expect(inferAsrSampleType(['asr-sample:scripted-reading'], 'torah-terms.webm')).toBe('scripted-reading');
  });

  it('keeps unknown imports explicitly unclassified', () => {
    expect(inferAsrSampleType([], 'recording.wav')).toBe('other');
  });
});
