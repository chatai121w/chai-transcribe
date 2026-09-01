import { describe, expect, it } from 'vitest';
import { classifyAsrEdit } from './asrEvidence';

describe('classifyAsrEdit', () => {
  it('recognises a timed single-word correction as acoustic evidence', () => {
    expect(classifyAsrEdit({
      original: 'מומן', corrected: 'מובן', start: 10, end: 10.7,
    })).toMatchObject({
      classification: 'acoustic-word-correction',
      hasAcousticEvidence: true,
      requiresHumanReview: true,
    });
  });

  it('does not treat punctuation-only changes as acoustic labels', () => {
    expect(classifyAsrEdit({
      original: 'אמר', corrected: 'אמר,', start: 10, end: 10.7,
    })).toMatchObject({ classification: 'editorial-change', hasAcousticEvidence: false });
  });

  it('does not accept an untimed edit as acoustic evidence', () => {
    expect(classifyAsrEdit({ original: 'א', corrected: 'ב' }))
      .toMatchObject({ classification: 'editorial-change', hasAcousticEvidence: false });
  });

  it('keeps insertions and deletions behind listening review', () => {
    expect(classifyAsrEdit({
      original: 'רבי', corrected: 'רבי עקיבא', start: 10, end: 11,
    })).toMatchObject({ classification: 'possible-acoustic-edit', requiresHumanReview: true });
  });
});
