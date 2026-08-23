import { describe, expect, it } from 'vitest';
import {
  chooseTranscriptFormattingModel,
  preservesTranscriptWords,
  splitExportParagraphs,
} from './transcriptFormatting';

describe('transcript formatting safety', () => {
  it('allows punctuation and paragraph breaks without changing words', () => {
    expect(preservesTranscriptWords(
      'שלום לכולם היום נלמד דבר חדש',
      'שלום לכולם.\n\nהיום נלמד דבר חדש!',
    )).toBe(true);
  });

  it('rejects an omitted or replaced word', () => {
    expect(preservesTranscriptWords('שלום לכולם היום נלמד', 'שלום לכולם. נלמד.')).toBe(false);
    expect(preservesTranscriptWords('שלום לכולם היום נלמד', 'שלום לכולם. מחר נלמד.')).toBe(false);
  });

  it('chooses the safe practical installed model instead of list order', () => {
    expect(chooseTranscriptFormattingModel([
      { name: 'translategemma:4b' },
      { name: 'qwen3.5:9b' },
      { name: 'gemma3:4b' },
    ])).toBe('gemma3:4b');
  });

  it('converts blank-line groups into real export paragraphs', () => {
    expect(splitExportParagraphs('פסקה ראשונה.\r\n\r\nפסקה שנייה,\nממשיכה כאן.')).toEqual([
      'פסקה ראשונה.',
      'פסקה שנייה, ממשיכה כאן.',
    ]);
  });

  it('creates visible paragraphs for a long punctuated single block', () => {
    const sentence = 'זהו משפט ארוך שמכיל מספיק מילים כדי לבדוק חלוקה תקינה וברורה במסמך וורד.';
    const paragraphs = splitExportParagraphs(Array.from({ length: 12 }, () => sentence).join(' '));
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.join(' ').replace(/\s+/g, ' ')).toBe(Array.from({ length: 12 }, () => sentence).join(' '));
  });
});
