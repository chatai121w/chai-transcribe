import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';
import { splitExportParagraphs } from '@/lib/transcriptFormatting';

export async function buildTranscriptDocxBlob(text: string, title: string, dateText: string): Promise<Blob> {
  const bodyParagraphs = splitExportParagraphs(text).map((paragraphText) => new Paragraph({
    children: [new TextRun({ text: paragraphText, size: 24, font: 'David', rightToLeft: true })],
    bidirectional: true,
    // Word mirrors left/right alignment inside bidi paragraphs. LEFT renders
    // as the physical right edge when w:bidi is enabled.
    alignment: AlignmentType.LEFT,
    spacing: { after: 280, line: 360 },
  }));

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 900, right: 1000, bottom: 900, left: 1000 } } },
      children: [
        new Paragraph({
          children: [new TextRun({ text: title, bold: true, size: 32, font: 'David', color: '111111', rightToLeft: true })],
          bidirectional: true,
          alignment: AlignmentType.LEFT,
          spacing: { after: 100 },
        }),
        new Paragraph({
          children: [new TextRun({ text: dateText, size: 20, color: '777777', font: 'David', rightToLeft: true })],
          bidirectional: true,
          alignment: AlignmentType.LEFT,
          spacing: { after: 280 },
        }),
        ...bodyParagraphs,
      ],
    }],
  });
  return Packer.toBlob(doc);
}
