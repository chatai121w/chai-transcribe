import { describe, expect, it } from 'vitest';
import { getTranscriptDisplay, safeTranscriptString } from './transcriptDisplay';

describe('transcript display normalization', () => {
  it('uses edited text before the original text', () => {
    expect(getTranscriptDisplay({ text: 'מקור', edited_text: 'ערוך' })).toEqual({
      title: 'ערוך',
      content: 'ערוך',
    });
  });

  it('does not crash on incomplete legacy records', () => {
    expect(getTranscriptDisplay({ title: undefined, text: undefined })).toEqual({
      title: 'ללא כותרת',
      content: '',
    });
    expect(getTranscriptDisplay({ title: { legacy: true }, text: 42 })).toEqual({
      title: 'ללא כותרת',
      content: '',
    });
  });

  it('returns an empty string for non-string values', () => {
    expect(safeTranscriptString(null)).toBe('');
    expect(safeTranscriptString('  טקסט  ')).toBe('  טקסט  ');
  });
});
