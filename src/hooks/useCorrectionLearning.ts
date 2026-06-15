import { useState, useCallback } from 'react';
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
} from '@/utils/correctionLearning';

export function useCorrectionLearning() {
  const [stats, setStats] = useState<CorrectionStats>(() => getCorrectionStats());
  const [corrections, setCorrections] = useState<CorrectionEntry[]>(() => getAllCorrections());

  const refresh = useCallback(() => {
    setStats(getCorrectionStats());
    setCorrections(getAllCorrections());
  }, []);

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
