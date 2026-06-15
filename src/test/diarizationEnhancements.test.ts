import { describe, it, expect } from 'vitest';
import {
  detectOverlaps,
  exportAsVTT,
  type DiarizedSegment,
} from '../utils/diarizationEnhancements';

const seg = (speaker: string, start: number, end: number, text = ''): DiarizedSegment => ({
  speaker,
  speaker_label: speaker,
  start,
  end,
  text,
});

describe('detectOverlaps', () => {
  it('returns empty array when no overlaps', () => {
    const segments = [
      seg('A', 0, 5, 'hello'),
      seg('B', 5, 10, 'world'),
    ];
    expect(detectOverlaps(segments)).toEqual([]);
  });

  it('detects overlap between two speakers', () => {
    const segments = [
      seg('A', 0, 6),
      seg('B', 4, 10),
    ];
    const overlaps = detectOverlaps(segments);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].start).toBe(4);
    expect(overlaps[0].end).toBe(6);
    expect(overlaps[0].speakers).toContain('A');
    expect(overlaps[0].speakers).toContain('B');
    expect(overlaps[0].duration).toBe(2);
  });

  it('ignores overlaps shorter than minOverlap', () => {
    const segments = [
      seg('A', 0, 5.1),
      seg('B', 5, 10),
    ];
    expect(detectOverlaps(segments, 0.3)).toEqual([]);
  });

  it('ignores same-speaker overlaps', () => {
    const segments = [
      seg('A', 0, 6),
      seg('A', 4, 10),
    ];
    expect(detectOverlaps(segments)).toEqual([]);
  });
});

describe('exportAsVTT', () => {
  it('generates valid VTT format', () => {
    const segments = [
      seg('SPEAKER_00', 0, 3.5, 'שלום'),
      seg('SPEAKER_01', 4, 7.2, 'מה שלומך'),
    ];
    const names: Record<string, string> = {
      'SPEAKER_00': 'דובר 1',
      'SPEAKER_01': 'דובר 2',
    };
    const vtt = exportAsVTT(segments, names);
    expect(vtt).toContain('WEBVTT');
    expect(vtt).toContain('00:00:00.000 --> 00:00:03.500');
    expect(vtt).toContain('<v דובר 1>שלום');
    expect(vtt).toContain('00:00:04.000 --> 00:00:07.200');
    expect(vtt).toContain('<v דובר 2>מה שלומך');
  });

  it('uses speaker_label as fallback name', () => {
    const segments = [seg('SPEAKER_00', 0, 1, 'test')];
    const vtt = exportAsVTT(segments, {});
    expect(vtt).toContain('<v SPEAKER_00>test');
  });
});
