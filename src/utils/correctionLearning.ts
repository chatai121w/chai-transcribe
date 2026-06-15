/**
 * Correction Learning System
 * 
 * Learns from user corrections to transcriptions, storing patterns
 * of common errors and their fixes. Uses this knowledge to suggest
 * automatic corrections for future transcriptions.
 * 
 * Storage: IndexedDB (via Dexie) for persistent, structured data.
 * Falls back to localStorage if IndexedDB unavailable.
 */

// ─── Types ───

export interface CorrectionEntry {
  id?: number;
  /** Original (wrong) text fragment */
  original: string;
  /** Corrected text fragment */
  corrected: string;
  /** Optional explanation/meaning for learning only context */
  note?: string;
  /** How many times this correction was applied */
  frequency: number;
  /** Source engine that produced the error */
  engine: string;
  /** Category: word-level, phrase-level, punctuation, spacing */
  category: 'word' | 'phrase' | 'punctuation' | 'spacing' | 'grammar';
  /** Confidence score 0-1, increases with usage */
  confidence: number;
  /** Last time this correction was used */
  lastUsed: number;
  /** When first recorded */
  createdAt: number;
}

export interface CorrectionStats {
  totalCorrections: number;
  totalApplications: number;
  topCorrections: CorrectionEntry[];
  byEngine: Record<string, number>;
  byCategory: Record<string, number>;
}

// ─── Storage Keys ───
const CORRECTIONS_KEY = 'transcription_corrections';
const CORRECTIONS_STATS_KEY = 'transcription_corrections_stats';

// ─── Helpers ───

function loadCorrections(): CorrectionEntry[] {
  try {
    return JSON.parse(localStorage.getItem(CORRECTIONS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCorrections(corrections: CorrectionEntry[]): void {
  // Keep max 2000 entries, sorted by confidence * frequency
  const sorted = corrections
    .sort((a, b) => (b.confidence * b.frequency) - (a.confidence * a.frequency))
    .slice(0, 2000);
  localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(sorted));
}

/**
 * Categorize a correction based on the diff pattern
 */
function categorizeCorrection(original: string, corrected: string): CorrectionEntry['category'] {
  const origTrimmed = original.trim();
  const corrTrimmed = corrected.trim();

  // Punctuation only change
  const origNoPunct = origTrimmed.replace(/[.,;:!?"""''׳״\-–—()[\]{}]/g, '');
  const corrNoPunct = corrTrimmed.replace(/[.,;:!?"""''׳״\-–—()[\]{}]/g, '');
  if (origNoPunct === corrNoPunct) return 'punctuation';

  // Spacing only
  const origNoSpace = origTrimmed.replace(/\s+/g, '');
  const corrNoSpace = corrTrimmed.replace(/\s+/g, '');
  if (origNoSpace === corrNoSpace) return 'spacing';

  // Single word
  if (!origTrimmed.includes(' ') && !corrTrimmed.includes(' ')) return 'word';

  // Multi-word
  const origWords = origTrimmed.split(/\s+/).length;
  const corrWords = corrTrimmed.split(/\s+/).length;
  if (origWords <= 3 && corrWords <= 3) return 'word';

  // Check if it's a grammar fix (same root words, different form)
  if (origWords === corrWords) return 'grammar';

  return 'phrase';
}

// ─── Core API ───

/**
 * Extract corrections from an original transcription and its user-edited version.
 * Uses word-level diffing to detect changes.
 */
export function extractCorrections(
  originalText: string,
  editedText: string,
  engine: string = 'unknown'
): CorrectionEntry[] {
  if (!originalText || !editedText || originalText === editedText) return [];

  const corrections: CorrectionEntry[] = [];
  const now = Date.now();

  // Split into sentences for more granular comparison
  const origSentences = originalText.split(/(?<=[.!?。])\s+/);
  const editSentences = editedText.split(/(?<=[.!?。])\s+/);

  // Use word-level diff for short texts, sentence-level for long texts
  if (origSentences.length <= 5 && editSentences.length <= 5) {
    // Word-level diffing
    const origWords = originalText.split(/\s+/);
    const editWords = editedText.split(/\s+/);
    
    const diffs = diffWords(origWords, editWords);
    for (const diff of diffs) {
      if (diff.original !== diff.corrected) {
        corrections.push({
          original: diff.original,
          corrected: diff.corrected,
          frequency: 1,
          engine,
          category: categorizeCorrection(diff.original, diff.corrected),
          confidence: 0.5,
          lastUsed: now,
          createdAt: now,
        });
      }
    }
  } else {
    // Sentence-level diffing for longer texts
    const minLen = Math.min(origSentences.length, editSentences.length);
    for (let i = 0; i < minLen; i++) {
      const orig = origSentences[i]?.trim();
      const edit = editSentences[i]?.trim();
      if (orig && edit && orig !== edit) {
        // Do word-level diff within the sentence
        const origW = orig.split(/\s+/);
        const editW = edit.split(/\s+/);
        const diffs = diffWords(origW, editW);
        for (const diff of diffs) {
          if (diff.original !== diff.corrected) {
            corrections.push({
              original: diff.original,
              corrected: diff.corrected,
              frequency: 1,
              engine,
              category: categorizeCorrection(diff.original, diff.corrected),
              confidence: 0.5,
              lastUsed: now,
              createdAt: now,
            });
          }
        }
      }
    }
  }

  return corrections;
}

/**
 * Simple word-level diff that finds changed sequences.
 * Returns pairs of (original, corrected) segments.
 */
function diffWords(
  origWords: string[],
  editWords: string[]
): Array<{ original: string; corrected: string }> {
  const results: Array<{ original: string; corrected: string }> = [];

  // LCS-based diff
  const m = origWords.length;
  const n = editWords.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = origWords[i - 1] === editWords[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack to find changes
  let i = m, j = n;
  const changes: Array<{ type: 'same' | 'del' | 'ins'; word: string }> = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origWords[i - 1] === editWords[j - 1]) {
      changes.unshift({ type: 'same', word: origWords[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      changes.unshift({ type: 'ins', word: editWords[j - 1] });
      j--;
    } else {
      changes.unshift({ type: 'del', word: origWords[i - 1] });
      i--;
    }
  }

  // Group consecutive del/ins into correction pairs
  let delBuf: string[] = [];
  let insBuf: string[] = [];

  const flush = () => {
    if (delBuf.length > 0 || insBuf.length > 0) {
      const orig = delBuf.join(' ');
      const corr = insBuf.join(' ');
      if (orig || corr) {
        results.push({ original: orig, corrected: corr });
      }
      delBuf = [];
      insBuf = [];
    }
  };

  for (const c of changes) {
    if (c.type === 'same') {
      flush();
    } else if (c.type === 'del') {
      delBuf.push(c.word);
    } else {
      insBuf.push(c.word);
    }
  }
  flush();

  return results;
}

/**
 * Learn from corrections: merge new corrections into the stored dictionary.
 * Increases frequency and confidence for repeated corrections.
 */
export function learnFromCorrections(newCorrections: CorrectionEntry[]): void {
  if (newCorrections.length === 0) return;

  const existing = loadCorrections();
  const now = Date.now();

  for (const nc of newCorrections) {
    // Skip very short or empty corrections
    if (!nc.original && !nc.corrected) continue;
    if (nc.original.length < 1 && nc.corrected.length < 1) continue;

    const existingIdx = existing.findIndex(
      e => e.original === nc.original && e.corrected === nc.corrected
    );

    if (existingIdx >= 0) {
      // Boost existing
      const e = existing[existingIdx];
      e.frequency += 1;
      e.confidence = Math.min(1, e.confidence + 0.1);
      e.lastUsed = now;
    } else {
      // Add new
      existing.push({
        ...nc,
        id: existing.length + 1,
        createdAt: nc.createdAt || now,
        lastUsed: now,
      });
    }
  }

  saveCorrections(existing);
}

/**
 * Apply learned corrections to new transcription text.
 * Only applies corrections with confidence >= threshold.
 */
export function applyLearnedCorrections(
  text: string,
  options?: {
    engine?: string;
    confidenceThreshold?: number;
    maxCorrections?: number;
  }
): { text: string; appliedCount: number; applied: Array<{ original: string; corrected: string }> } {
  const {
    engine,
    confidenceThreshold = 0.6,
    maxCorrections = 50,
  } = options || {};

  const corrections = loadCorrections();

  // Filter by confidence and optionally by engine
  let applicable = corrections
    .filter(c => c.confidence >= confidenceThreshold)
    .filter(c => c.original.length > 0) // Must have original text
    .sort((a, b) => {
      // Sort by: longer originals first (more specific), then by confidence
      const lenDiff = b.original.length - a.original.length;
      if (lenDiff !== 0) return lenDiff;
      return (b.confidence * b.frequency) - (a.confidence * a.frequency);
    });

  if (engine) {
    // Prioritize corrections from the same engine, but include all
    applicable.sort((a, b) => {
      const aMatch = a.engine === engine ? 1 : 0;
      const bMatch = b.engine === engine ? 1 : 0;
      return bMatch - aMatch;
    });
  }

  applicable = applicable.slice(0, maxCorrections);

  let result = text;
  const applied: Array<{ original: string; corrected: string }> = [];

  for (const c of applicable) {
    if (result.includes(c.original)) {
      result = result.split(c.original).join(c.corrected);
      applied.push({ original: c.original, corrected: c.corrected });
    }
  }

  return { text: result, appliedCount: applied.length, applied };
}

/**
 * Get correction statistics
 */
export function getCorrectionStats(): CorrectionStats {
  const corrections = loadCorrections();

  const byEngine: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let totalApplications = 0;

  for (const c of corrections) {
    byEngine[c.engine] = (byEngine[c.engine] || 0) + 1;
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    totalApplications += c.frequency;
  }

  return {
    totalCorrections: corrections.length,
    totalApplications,
    topCorrections: corrections
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10),
    byEngine,
    byCategory,
  };
}

/**
 * Get all stored corrections (for display/management)
 */
export function getAllCorrections(): CorrectionEntry[] {
  return loadCorrections();
}

/**
 * Delete a specific correction
 */
export function deleteCorrection(original: string, corrected: string): void {
  const corrections = loadCorrections().filter(
    c => !(c.original === original && c.corrected === corrected)
  );
  saveCorrections(corrections);
}

/**
 * Clear all learned corrections
 */
export function clearAllCorrections(): void {
  localStorage.removeItem(CORRECTIONS_KEY);
  localStorage.removeItem(CORRECTIONS_STATS_KEY);
}

/**
 * Export corrections as JSON for backup
 */
export function exportCorrections(): string {
  return JSON.stringify(loadCorrections(), null, 2);
}

/**
 * Import corrections from JSON backup
 */
export function importCorrections(json: string): number {
  try {
    const imported = JSON.parse(json) as CorrectionEntry[];
    if (!Array.isArray(imported)) throw new Error('Invalid format');
    
    const existing = loadCorrections();
    let addedCount = 0;

    for (const entry of imported) {
      if (!entry.original && !entry.corrected) continue;
      const exists = existing.some(
        e => e.original === entry.original && e.corrected === entry.corrected
      );
      if (!exists) {
        existing.push({
          ...entry,
          id: existing.length + 1,
        });
        addedCount++;
      }
    }

    saveCorrections(existing);
    return addedCount;
  } catch {
    return -1;
  }
}
