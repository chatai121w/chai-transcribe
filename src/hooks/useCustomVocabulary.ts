import { useState, useCallback, useEffect } from 'react';
import {
  addTerm, addTermsBulk, updateTerm, removeTerm, getAllTerms,
  getHotwordsString, getVocabularyStats, clearVocabulary,
  exportVocabulary, importVocabulary, applyVocabularyCorrections,
  VOCABULARY_CHANGED_EVENT,
  type VocabularyEntry, type VocabularyMetadata, type VocabularyStats,
} from '@/utils/customVocabulary';
import { clearTorahLexiconCloud, deleteTorahLexiconTermFromCloud, syncTorahLexicon } from '@/lib/torahLexiconCloud';

export type VocabularyCloudState = 'idle' | 'syncing' | 'synced' | 'local-only' | 'error';

export function useCustomVocabulary() {
  const [entries, setEntries] = useState<VocabularyEntry[]>(() => getAllTerms());
  const [stats, setStats] = useState<VocabularyStats>(() => getVocabularyStats());
  const [cloudState, setCloudState] = useState<VocabularyCloudState>('idle');
  const [cloudError, setCloudError] = useState('');

  const refresh = useCallback(() => {
    setEntries(getAllTerms());
    setStats(getVocabularyStats());
  }, []);

  const syncCloud = useCallback(async () => {
    setCloudState('syncing');
    const result = await syncTorahLexicon();
    refresh();
    if (result.errors.length === 0) {
      setCloudState('synced');
      setCloudError('');
    } else if (result.errors.every(error => error.includes('לא מחובר'))) {
      setCloudState('local-only');
      setCloudError(result.errors.join(' · '));
    } else {
      setCloudState('error');
      setCloudError(result.errors.join(' · '));
    }
    return result;
  }, [refresh]);

  useEffect(() => {
    void syncCloud();
  }, [syncCloud]);

  useEffect(() => {
    window.addEventListener(VOCABULARY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(VOCABULARY_CHANGED_EVENT, refresh);
  }, [refresh]);

  const add = useCallback((term: string, category?: VocabularyEntry['category'], variants?: string[], metadata?: VocabularyMetadata) => {
    const ok = addTerm(term, category, variants, metadata);
    if (ok) { refresh(); void syncCloud(); }
    return ok;
  }, [refresh, syncCloud]);

  const addBulk = useCallback((terms: string[], category?: VocabularyEntry['category']) => {
    const count = addTermsBulk(terms, category);
    if (count > 0) { refresh(); void syncCloud(); }
    return count;
  }, [refresh, syncCloud]);

  const update = useCallback((originalTerm: string, updates: Partial<Pick<VocabularyEntry, 'term' | 'category' | 'variants' | 'pronunciation' | 'contextTags' | 'approvalStatus' | 'confidence' | 'notes'>>) => {
    const ok = updateTerm(originalTerm, updates);
    if (ok) { refresh(); void syncCloud(); }
    return ok;
  }, [refresh, syncCloud]);

  const addAndSync = useCallback(async (term: string, category?: VocabularyEntry['category'], variants?: string[], metadata?: VocabularyMetadata) => {
    const ok = addTerm(term, category, variants, metadata);
    if (!ok) return { ok: false, errors: [] as string[] };
    refresh();
    const result = await syncCloud();
    return { ok: true, errors: result.errors };
  }, [refresh, syncCloud]);

  const updateAndSync = useCallback(async (originalTerm: string, updates: Partial<Pick<VocabularyEntry, 'term' | 'category' | 'variants' | 'pronunciation' | 'contextTags' | 'approvalStatus' | 'confidence' | 'notes'>>) => {
    const ok = updateTerm(originalTerm, updates);
    if (!ok) return { ok: false, errors: [] as string[] };
    refresh();
    const result = await syncCloud();
    return { ok: true, errors: result.errors };
  }, [refresh, syncCloud]);

  const remove = useCallback((term: string) => {
    removeTerm(term);
    refresh();
    void deleteTorahLexiconTermFromCloud(term);
  }, [refresh]);

  const clearAll = useCallback(() => {
    clearVocabulary();
    refresh();
    void clearTorahLexiconCloud();
  }, [refresh]);

  const getHotwords = useCallback(() => getHotwordsString(), []);

  const applyCorrections = useCallback((text: string) => applyVocabularyCorrections(text), []);

  const exportData = useCallback(() => exportVocabulary(), []);

  const importData = useCallback((json: string) => {
    const count = importVocabulary(json);
    if (count > 0) { refresh(); void syncCloud(); }
    return count;
  }, [refresh, syncCloud]);

  return {
    entries, stats, add, addAndSync, addBulk, update, updateAndSync, remove,
    clearAll, getHotwords, applyCorrections,
    exportData, importData, refresh, syncCloud, cloudState, cloudError,
  };
}
