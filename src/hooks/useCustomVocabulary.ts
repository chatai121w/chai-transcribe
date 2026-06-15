import { useState, useCallback } from 'react';
import {
  addTerm, addTermsBulk, updateTerm, removeTerm, getAllTerms,
  getHotwordsString, getVocabularyStats, clearVocabulary,
  exportVocabulary, importVocabulary, applyVocabularyCorrections,
  type VocabularyEntry, type VocabularyStats,
} from '@/utils/customVocabulary';

export function useCustomVocabulary() {
  const [entries, setEntries] = useState<VocabularyEntry[]>(() => getAllTerms());
  const [stats, setStats] = useState<VocabularyStats>(() => getVocabularyStats());

  const refresh = useCallback(() => {
    setEntries(getAllTerms());
    setStats(getVocabularyStats());
  }, []);

  const add = useCallback((term: string, category?: VocabularyEntry['category'], variants?: string[]) => {
    const ok = addTerm(term, category, variants);
    if (ok) refresh();
    return ok;
  }, [refresh]);

  const addBulk = useCallback((terms: string[], category?: VocabularyEntry['category']) => {
    const count = addTermsBulk(terms, category);
    if (count > 0) refresh();
    return count;
  }, [refresh]);

  const update = useCallback((originalTerm: string, updates: Partial<Pick<VocabularyEntry, 'term' | 'category' | 'variants'>>) => {
    const ok = updateTerm(originalTerm, updates);
    if (ok) refresh();
    return ok;
  }, [refresh]);

  const remove = useCallback((term: string) => {
    removeTerm(term);
    refresh();
  }, [refresh]);

  const clearAll = useCallback(() => {
    clearVocabulary();
    refresh();
  }, [refresh]);

  const getHotwords = useCallback(() => getHotwordsString(), []);

  const applyCorrections = useCallback((text: string) => applyVocabularyCorrections(text), []);

  const exportData = useCallback(() => exportVocabulary(), []);

  const importData = useCallback((json: string) => {
    const count = importVocabulary(json);
    if (count > 0) refresh();
    return count;
  }, [refresh]);

  return {
    entries, stats, add, addBulk, update, remove,
    clearAll, getHotwords, applyCorrections,
    exportData, importData, refresh,
  };
}
