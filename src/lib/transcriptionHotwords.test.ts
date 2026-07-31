import { beforeEach, describe, expect, it } from 'vitest';
import { addTermsBulk } from '@/utils/customVocabulary';
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
});
