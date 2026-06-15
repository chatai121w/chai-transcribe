import { describe, it, expect, beforeEach } from 'vitest';
import {
  addTerm,
  addTermsBulk,
  updateTerm,
  removeTerm,
  getAllTerms,
  getTermsByCategory,
  getHotwordsString,
  getVocabularyStats,
  clearVocabulary,
  exportVocabulary,
  importVocabulary,
  applyVocabularyCorrections,
} from './customVocabulary';

// Mock localStorage
const store: Record<string, string> = {};
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
      clear: () => Object.keys(store).forEach(k => delete store[k]),
    },
    writable: true,
    configurable: true,
  });
});

describe('addTerm', () => {
  it('adds a term and retrieves it', () => {
    expect(addTerm('ירושלים', 'place')).toBe(true);
    const terms = getAllTerms();
    expect(terms).toHaveLength(1);
    expect(terms[0].term).toBe('ירושלים');
    expect(terms[0].category).toBe('place');
  });

  it('rejects duplicate terms', () => {
    addTerm('ירושלים');
    expect(addTerm('ירושלים')).toBe(false);
    expect(getAllTerms()).toHaveLength(1);
  });

  it('rejects empty terms', () => {
    expect(addTerm('')).toBe(false);
    expect(addTerm('   ')).toBe(false);
  });

  it('trims whitespace', () => {
    addTerm('  ירושלים  ', 'place');
    expect(getAllTerms()[0].term).toBe('ירושלים');
  });

  it('stores variants', () => {
    addTerm('ירושלים', 'place', ['ירושליים', 'ירושלם']);
    const entry = getAllTerms()[0];
    expect(entry.variants).toEqual(['ירושליים', 'ירושלם']);
  });
});

describe('addTermsBulk', () => {
  it('adds multiple terms at once', () => {
    const count = addTermsBulk(['תל אביב', 'חיפה', 'באר שבע'], 'place');
    expect(count).toBe(3);
    expect(getAllTerms()).toHaveLength(3);
  });

  it('skips duplicates in bulk', () => {
    addTerm('תל אביב');
    const count = addTermsBulk(['תל אביב', 'חיפה']);
    expect(count).toBe(1);
    expect(getAllTerms()).toHaveLength(2);
  });
});

describe('updateTerm', () => {
  it('updates an existing term', () => {
    addTerm('ירושלים', 'place');
    expect(updateTerm('ירושלים', { category: 'other' })).toBe(true);
    expect(getAllTerms()[0].category).toBe('other');
  });

  it('returns false for non-existent term', () => {
    expect(updateTerm('לא קיים', { category: 'name' })).toBe(false);
  });
});

describe('removeTerm', () => {
  it('removes a term', () => {
    addTerm('ירושלים');
    addTerm('תל אביב');
    removeTerm('ירושלים');
    const terms = getAllTerms();
    expect(terms).toHaveLength(1);
    expect(terms[0].term).toBe('תל אביב');
  });
});

describe('getTermsByCategory', () => {
  it('filters by category', () => {
    addTerm('ירושלים', 'place');
    addTerm('משה', 'name');
    addTerm('חיפה', 'place');
    expect(getTermsByCategory('place')).toHaveLength(2);
    expect(getTermsByCategory('name')).toHaveLength(1);
  });
});

describe('getHotwordsString', () => {
  it('generates comma-separated string', () => {
    addTerm('ירושלים');
    addTerm('תל אביב');
    const hw = getHotwordsString();
    expect(hw).toContain('ירושלים');
    expect(hw).toContain('תל אביב');
    expect(hw).toContain(', ');
  });

  it('returns empty string when no terms', () => {
    expect(getHotwordsString()).toBe('');
  });
});

describe('getVocabularyStats', () => {
  it('provides correct stats', () => {
    addTerm('ירושלים', 'place');
    addTerm('משה', 'name');
    const stats = getVocabularyStats();
    expect(stats.totalTerms).toBe(2);
    expect(stats.byCategory.place).toBe(1);
    expect(stats.byCategory.name).toBe(1);
  });
});

describe('clearVocabulary', () => {
  it('removes all terms', () => {
    addTerm('ירושלים');
    addTerm('תל אביב');
    clearVocabulary();
    expect(getAllTerms()).toHaveLength(0);
  });
});

describe('export / import', () => {
  it('round-trips data', () => {
    addTerm('ירושלים', 'place', ['ירושליים']);
    addTerm('משה', 'name');
    const json = exportVocabulary();
    clearVocabulary();
    expect(getAllTerms()).toHaveLength(0);
    const count = importVocabulary(json);
    expect(count).toBe(2);
    expect(getAllTerms()).toHaveLength(2);
  });

  it('rejects invalid JSON', () => {
    expect(importVocabulary('not json')).toBe(-1);
  });

  it('rejects non-array JSON', () => {
    expect(importVocabulary('{"a":1}')).toBe(-1);
  });
});

describe('applyVocabularyCorrections', () => {
  it('replaces known variants with correct term', () => {
    addTerm('ירושלים', 'place', ['ירושליים', 'ירושלם']);
    const result = applyVocabularyCorrections('הנסיעה לירושליים הייתה נהדרת');
    expect(result.text).toBe('הנסיעה לירושלים הייתה נהדרת');
    expect(result.appliedCount).toBe(1);
  });

  it('does nothing when no variants match', () => {
    addTerm('ירושלים', 'place', ['ירושליים']);
    const result = applyVocabularyCorrections('שלום עולם');
    expect(result.text).toBe('שלום עולם');
    expect(result.appliedCount).toBe(0);
  });
});
