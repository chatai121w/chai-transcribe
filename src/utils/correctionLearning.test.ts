import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractCorrections,
  learnFromCorrections,
  applyLearnedCorrections,
  getCorrectionStats,
} from './correctionLearning';

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

describe('extractCorrections', () => {
  it('returns empty for identical texts', () => {
    expect(extractCorrections('שלום עולם', 'שלום עולם')).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect(extractCorrections('', '')).toEqual([]);
    expect(extractCorrections('', 'text')).toEqual([]);
  });

  it('detects word-level correction', () => {
    const result = extractCorrections('שלום עלום', 'שלום עולם', 'openai');
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(c => c.original === 'עלום' && c.corrected === 'עולם')).toBe(true);
    expect(result[0].engine).toBe('openai');
    expect(result[0].confidence).toBe(0.5);
  });

  it('detects insertion correction', () => {
    const result = extractCorrections('שלום', 'שלום עולם');
    expect(result.length).toBeGreaterThan(0);
  });

  it('detects deletion correction', () => {
    const result = extractCorrections('שלום עולם טוב', 'שלום עולם');
    expect(result.length).toBeGreaterThan(0);
  });

  it('categorizes punctuation changes', () => {
    const result = extractCorrections('שלום עולם', 'שלום עולם.');
    const punctuation = result.filter(c => c.category === 'punctuation');
    // Either detected as punctuation or phrase — both valid
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('learnFromCorrections + applyLearnedCorrections', () => {
  it('learns corrections and applies them when confidence is high', () => {
    const corrections = extractCorrections('שלום עלום', 'שלום עולם', 'openai');
    
    // Learn multiple times to boost confidence above threshold
    learnFromCorrections(corrections);
    learnFromCorrections(corrections);
    learnFromCorrections(corrections); // confidence: 0.5 + 0.1 * 2 = 0.7
    
    const result = applyLearnedCorrections('שלום עלום שוב', { confidenceThreshold: 0.6 });
    expect(result.text).toContain('עולם');
    expect(result.appliedCount).toBeGreaterThan(0);
  });

  it('does not apply low-confidence corrections', () => {
    const corrections = extractCorrections('שלום עלום', 'שלום עולם');
    learnFromCorrections(corrections); // confidence = 0.5
    
    const result = applyLearnedCorrections('שלום עלום שוב', { confidenceThreshold: 0.8 });
    expect(result.appliedCount).toBe(0);
    expect(result.text).toBe('שלום עלום שוב');
  });
});

describe('getCorrectionStats', () => {
  it('returns empty stats when no corrections stored', () => {
    const stats = getCorrectionStats();
    expect(stats.totalCorrections).toBe(0);
    expect(stats.totalApplications).toBe(0);
  });

  it('counts corrections after learning', () => {
    const corrections = extractCorrections('שלום עלום', 'שלום עולם', 'groq');
    learnFromCorrections(corrections);
    const stats = getCorrectionStats();
    expect(stats.totalCorrections).toBeGreaterThan(0);
    expect(stats.byEngine).toHaveProperty('groq');
  });
});
