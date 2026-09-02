import { useState, useCallback, useEffect } from 'react';
import {
  extractCorrections,
  learnFromCorrections,
  applyLearnedCorrections,
  getCorrectionStats,
  getAllCorrections,
  deleteCorrection,
  clearAllCorrections,
  exportCorrections,
  importCorrections,
  type CorrectionEntry,
  type CorrectionStats,
  CORRECTIONS_CHANGED_EVENT,
} from '@/utils/correctionLearning';
import { CORRECTIONS_LEGACY_KEY, CORRECTIONS_V2_KEY } from '@/lib/correctionRepository';

export function useCorrectionLearning() {
  const [stats, setStats] = useState<CorrectionStats>(() => getCorrectionStats());
  const [corrections, setCorrections] = useState<CorrectionEntry[]>(() => getAllCorrections());

  const refresh = useCallback(() => {
    setStats(getCorrectionStats());
    setCorrections(getAllCorrections());
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (
        event.key === CORRECTIONS_V2_KEY ||
        event.key === CORRECTIONS_LEGACY_KEY ||
        event.key === 'transcription_corrections_stats'
      ) {
        refresh();
      }
    };
    window.addEventListener(CORRECTIONS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(CORRECTIONS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', handleStorage);
    };
  }, [refresh]);

  /** Learn from a user edit: compare original transcription to user-edited version */
  const learn = useCallback((originalText: string, editedText: string, engine?: string) => {
    const newCorrections = extractCorrections(originalText, editedText, engine);
    if (newCorrections.length > 0) {
      learnFromCorrections(newCorrections);
      refresh();
    }
    return newCorrections.length;
  }, [refresh]);

  /** Apply learned corrections to new text */
  const applyCorrections = useCallback((
    text: string,
    options?: { engine?: string; confidenceThreshold?: number }
  ) => {
    return applyLearnedCorrections(text, options);
  }, []);

  /** Remove a single correction */
  const removeCorrection = useCallback((original: string, corrected: string) => {
    deleteCorrection(original, corrected);
    refresh();
  }, [refresh]);

  /** Clear all learned data */
  const clearAll = useCallback(() => {
    clearAllCorrections();
    refresh();
  }, [refresh]);

  /** Export as JSON string */
  const exportData = useCallback(() => {
    return exportCorrections();
  }, []);

  /** Import from JSON string, returns count of imported */
  const importData = useCallback((json: string) => {
    const count = importCorrections(json);
    refresh();
    return count;
  }, [refresh]);

  return {
    stats,
    corrections,
    learn,
    applyCorrections,
    removeCorrection,
    clearAll,
    exportData,
    importData,
    refresh,
  };
}
