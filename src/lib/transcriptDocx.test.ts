import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildTranscriptDocxBlob } from './transcriptDocx';

describe('Word transcript export', () => {
  it('writes distinct RTL right-aligned paragraphs without Word heading theme', async () => {
    const blob = await buildTranscriptDocxBlob(
      'פסקה ראשונה עם פיסוק נכון.\n\nפסקה שנייה שמתחילה בנושא חדש.\n\nפסקה שלישית לסיכום.',
      'תמלול בעברית',
      '22.8.2026',
    );
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect((xml.match(/<w:p[ >]/g) || []).length).toBe(5);
    expect((xml.match(/<w:bidi\/>/g) || []).length).toBe(5);
    expect((xml.match(/<w:jc w:val="left"\/>/g) || []).length).toBe(5);
    expect((xml.match(/<w:rtl\/>/g) || []).length).toBe(5);
    expect(xml).not.toContain('w:pStyle w:val="Heading1"');
    expect(xml).toContain('w:color w:val="111111"');
  });
});
