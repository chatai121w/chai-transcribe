import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyLkAiFix,
  setLoshonKodeshEnabled,
  setLoshonKodeshReplacements,
} from './loshonKodesh';
import { setPersonalPronunciationEnabled } from './personalPronunciationModel';
import { applyTranscriptionKnowledge, applyTranscriptionKnowledgeWithAi } from './transcriptionKnowledge';
import { learnFromCorrections } from '@/utils/correctionLearning';
import { setDefinitiveRulesEnabled } from '@/utils/hebrewRuleEngine';

vi.mock('./loshonKodesh', async () => {
  const actual = await vi.importActual<typeof import('./loshonKodesh')>('./loshonKodesh');
  return { ...actual, applyLkAiFix: vi.fn() };
});

const mockedApplyLkAiFix = vi.mocked(applyLkAiFix);

describe('canonical transcription knowledge pipeline', () => {
  beforeEach(() => {
    localStorage.clear();
    setPersonalPronunciationEnabled(false);
    setDefinitiveRulesEnabled(true);
    mockedApplyLkAiFix.mockReset();
  });

  it('uses the explicit run setting instead of a stale global LK toggle', () => {
    setLoshonKodeshEnabled(true);
    const disabled = applyTranscriptionKnowledge('פדיון הקדיש', 'test', { loshonKodesh: false });
    expect(disabled.text).toBe('פדיון הקדיש');
    expect(disabled.counts.loshonKodesh).toBe(0);

    setLoshonKodeshEnabled(false);
    const enabled = applyTranscriptionKnowledge('פדיון הקדיש', 'test', { loshonKodesh: true });
    expect(enabled.text).toBe('פדיון הקדש');
    expect(enabled.counts.loshonKodesh).toBe(1);
  });

  it('reports every deterministic occurrence with its layer', () => {
    const result = applyTranscriptionKnowledge('פדיון הקדיש פדיון הקדיש', 'test', { loshonKodesh: true });

    expect(result.counts.loshonKodesh).toBe(2);
    expect(result.totalApplied).toBe(2);
    expect(result.changes).toContainEqual(expect.objectContaining({
      layer: 'loshon-kodesh',
      from: 'פדיון הקדיש',
      to: 'פדיון הקדש',
      count: 2,
    }));
  });

  it('protects a verified human correction from a conflicting broad LK rule', () => {
    setPersonalPronunciationEnabled(true);
    setLoshonKodeshReplacements([
      { from: 'ארומך', to: 'ארוממך שגוי', category: 'terms' },
      { from: 'ארוממך', to: 'ארוממך שגוי', category: 'terms' },
    ]);
    learnFromCorrections([{
      original: 'ארומך',
      corrected: 'ארוממך',
      frequency: 3,
      engine: 'test',
      category: 'word',
      confidence: 1,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    }]);

    const result = applyTranscriptionKnowledge('ארומך אלוהי המלך', 'test', { loshonKodesh: true });
    expect(result.text).toBe('ארוממך אלוהי המלך');
    expect(result.counts.learned).toBe(1);
    expect(result.counts.loshonKodesh).toBe(0);
  });

  it('always enforces final letters even when optional rule systems are disabled', () => {
    setDefinitiveRulesEnabled(false);

    const result = applyTranscriptionKnowledge('שלומ מלךים םשה', 'test', { loshonKodesh: false });

    expect(result.text).toBe('שלום מלכים משה');
    expect(result.counts.orthography).toBe(3);
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ layer: 'orthography', from: 'שלומ', to: 'שלום' }),
    ]));
  });

  it('revalidates a learned correction after protected output is restored', () => {
    setPersonalPronunciationEnabled(true);
    learnFromCorrections([{
      original: 'שיבוש',
      corrected: 'שלומ',
      frequency: 3,
      engine: 'test',
      category: 'word',
      confidence: 1,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    }]);

    const result = applyTranscriptionKnowledge('שיבוש', 'test', { loshonKodesh: false });

    expect(result.text).toBe('שלום');
    expect(result.counts.learned).toBe(1);
    expect(result.counts.orthography).toBe(1);
  });

  it('uses the mandatory orthography gate after the optional AI layer', async () => {
    mockedApplyLkAiFix.mockResolvedValue('שלומ מלךים םשה');

    const result = await applyTranscriptionKnowledgeWithAi('טקסט תקין', 'test', {
      loshonKodesh: true,
      ai: true,
    });

    expect(result.text).toBe('שלום מלכים משה');
    expect(result.counts.ai).toBeGreaterThan(0);
    expect(result.counts.orthography).toBe(3);
  });
});
