import { beforeEach, describe, expect, it } from 'vitest';
import { addTerm, addTermsBulk, normalizeVocabularyKey, seedTorahLexicon } from '@/utils/customVocabulary';
import { seedTalmudicCorrections } from '@/utils/talmudicCorrectionsSeed';
import { buildTranscriptionHotwords } from './transcriptionHotwords';

describe('buildTranscriptionHotwords', () => {
  beforeEach(() => localStorage.clear());

  it('deduplicates and bounds the vocabulary sent to an ASR engine', () => {
    addTermsBulk(['רב האי גאון', 'בבא בתרא', 'רב האי גאון']);
    const result = buildTranscriptionHotwords({ manual: 'בבא בתרא, ידני', limit: 3 });
    const terms = result?.split(', ') || [];

    expect(terms).toHaveLength(3);
    expect(terms.filter((term) => term === 'בבא בתרא')).toHaveLength(1);
    expect(terms[0]).toBe('בבא בתרא');
  });

  it('prioritizes a term mentioned by the file context', () => {
    addTermsBulk(['תהילים', 'מסכת ברכות']);
    const result = buildTranscriptionHotwords({ manual: 'מונח ידני', context: 'תהילים פרק קד.mp3', limit: 2 });
    expect(result?.split(', ')).toContain('תהילים');
  });

  it('deduplicates quote variants across manual and central lexicon sources', () => {
    addTerm('רש״י', 'commentator');
    const result = buildTranscriptionHotwords({ manual: 'רש"י', limit: 20 });
    const matches = (result?.split(', ') || [])
      .filter(term => normalizeVocabularyKey(term) === normalizeVocabularyKey('רש״י'));

    expect(matches).toHaveLength(1);
  });

  it('ranks the matching built-in Torah term for the recording context', () => {
    seedTorahLexicon(true);
    const result = buildTranscriptionHotwords({ context: 'שיעור במסכת בבא בתרא', limit: 3 });

    expect(result?.split(', ')).toContain('בבא בתרא');
  });

  it('keeps learned Torah corrections targeted without sending unrelated built-in terms', () => {
    seedTorahLexicon(true);
    seedTalmudicCorrections(true);
    const terms = buildTranscriptionHotwords({
      context: 'דברים - הרב משה שפירא זצל.mp3',
      loshonKodesh: false,
      limit: 60,
    })?.split(', ') || [];

    expect(terms).toContain('רב האי גאון');
    expect(terms).toContain('בבא בתרא');
    expect(terms).not.toContain('ברכות');
    expect(terms).not.toContain('שבת');
    expect(terms.length).toBeLessThan(30);
  });

  it('produces one normalized term even when all legacy sources are enabled', () => {
    seedTorahLexicon(true);
    addTerm('רש"י', 'commentator');
    const terms = buildTranscriptionHotwords({
      manual: 'רש״י, בבא בתרא',
      loshonKodesh: true,
      limit: 500,
    })?.split(', ') || [];
    const keys = terms.map(normalizeVocabularyKey);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
