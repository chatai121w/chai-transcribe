import { beforeEach, describe, expect, it } from 'vitest';
import {
  CORRECTIONS_LEGACY_KEY,
  CORRECTIONS_MIGRATION_KEY,
  CORRECTIONS_V2_KEY,
  getAllScopedCorrections,
  getScopedCorrections,
  replaceScopedCorrections,
} from './correctionRepository';

const store: Record<string, string> = {};

beforeEach(() => {
  Object.keys(store).forEach((key) => delete store[key]);
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    },
    configurable: true,
  });
});

const correction = (original: string, corrected: string) => ({
  original,
  corrected,
  frequency: 1,
  engine: 'test',
  category: 'word' as const,
  confidence: 0.8,
  lastUsed: 2,
  createdAt: 1,
});

describe('correctionRepository', () => {
  it('migrates global and profile legacy stores without deleting rollback data', () => {
    localStorage.setItem(CORRECTIONS_LEGACY_KEY, JSON.stringify([correction('שגוי', 'תקין')]));
    localStorage.setItem('pp_profiles_index', JSON.stringify([{ id: 'rabbi-a' }]));
    localStorage.setItem('pp_profile_rabbi-a_corrections', JSON.stringify([correction('קוידש', 'קודש')]));

    expect(getScopedCorrections('global')).toHaveLength(1);
    expect(getScopedCorrections('profile', 'rabbi-a')).toHaveLength(1);
    expect(localStorage.getItem(CORRECTIONS_V2_KEY)).toBeTruthy();
    expect(localStorage.getItem(CORRECTIONS_MIGRATION_KEY)).toContain('legacyKeysPreserved');
    expect(localStorage.getItem(CORRECTIONS_LEGACY_KEY)).toBeTruthy();
  });

  it('keeps global and profile corrections in one physical source with explicit scope', () => {
    replaceScopedCorrections('global', [correction('א', 'ב')]);
    replaceScopedCorrections('profile', [correction('ג', 'ד')], 'rabbi-a');

    const all = getAllScopedCorrections();
    expect(all).toHaveLength(2);
    expect(all.map((entry) => [entry.scope, entry.profileId || ''])).toEqual(
      expect.arrayContaining([['global', ''], ['profile', 'rabbi-a']]),
    );
  });

  it('replaces one scope without erasing the other scope', () => {
    replaceScopedCorrections('global', [correction('א', 'ב')]);
    replaceScopedCorrections('profile', [correction('ג', 'ד')], 'rabbi-a');
    replaceScopedCorrections('global', [correction('ה', 'ו')]);

    expect(getScopedCorrections('global').map((entry) => entry.original)).toEqual(['ה']);
    expect(getScopedCorrections('profile', 'rabbi-a').map((entry) => entry.original)).toEqual(['ג']);
  });

  it('deduplicates the same correction inside one scope even when engines differ', () => {
    replaceScopedCorrections('global', [
      correction('שבוש', 'שיבוש'),
      { ...correction('שבוש', 'שיבוש'), engine: 'other', confidence: 1 },
    ]);

    expect(getScopedCorrections('global')).toHaveLength(1);
    expect(getScopedCorrections('global')[0].confidence).toBe(1);
  });
});
