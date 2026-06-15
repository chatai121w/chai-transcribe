/**
 * Custom Vocabulary System
 * 
 * Manages a personal dictionary of terms, names, and phrases that
 * should be recognized correctly in transcriptions. Feeds into
 * Whisper hotwords and correction learning.
 */

export interface VocabularyEntry {
  /** The correct term/name */
  term: string;
  /** Optional: common misheard variants */
  variants: string[];
  /** Category for organization */
  category: 'name' | 'place' | 'technical' | 'organization' | 'other';
  /** How often this term appears in transcriptions */
  usageCount: number;
  /** When added */
  createdAt: number;
}

export interface VocabularyStats {
  totalTerms: number;
  byCategory: Record<string, number>;
  hotwordsString: string;
}

const VOCAB_KEY = 'custom_vocabulary';

function loadVocabulary(): VocabularyEntry[] {
  try {
    return JSON.parse(localStorage.getItem(VOCAB_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveVocabulary(entries: VocabularyEntry[]): void {
  localStorage.setItem(VOCAB_KEY, JSON.stringify(entries));
}

/** Add a new term to the vocabulary */
export function addTerm(
  term: string,
  category: VocabularyEntry['category'] = 'other',
  variants: string[] = []
): boolean {
  const vocab = loadVocabulary();
  const trimmed = term.trim();
  if (!trimmed) return false;
  
  // Check for duplicates
  if (vocab.some(v => v.term === trimmed)) return false;
  
  vocab.push({
    term: trimmed,
    variants: variants.map(v => v.trim()).filter(Boolean),
    category,
    usageCount: 0,
    createdAt: Date.now(),
  });
  
  saveVocabulary(vocab);
  return true;
}

/** Add multiple terms at once (bulk import) */
export function addTermsBulk(
  terms: string[],
  category: VocabularyEntry['category'] = 'other'
): number {
  const vocab = loadVocabulary();
  const existingTerms = new Set(vocab.map(v => v.term));
  let added = 0;
  
  for (const raw of terms) {
    const trimmed = raw.trim();
    if (!trimmed || existingTerms.has(trimmed)) continue;
    vocab.push({
      term: trimmed,
      variants: [],
      category,
      usageCount: 0,
      createdAt: Date.now(),
    });
    existingTerms.add(trimmed);
    added++;
  }
  
  saveVocabulary(vocab);
  return added;
}

/** Update an existing term */
export function updateTerm(
  originalTerm: string,
  updates: Partial<Pick<VocabularyEntry, 'term' | 'category' | 'variants'>>
): boolean {
  const vocab = loadVocabulary();
  const idx = vocab.findIndex(v => v.term === originalTerm);
  if (idx < 0) return false;
  
  if (updates.term !== undefined) vocab[idx].term = updates.term.trim();
  if (updates.category !== undefined) vocab[idx].category = updates.category;
  if (updates.variants !== undefined) vocab[idx].variants = updates.variants;
  
  saveVocabulary(vocab);
  return true;
}

/** Remove a term */
export function removeTerm(term: string): void {
  const vocab = loadVocabulary().filter(v => v.term !== term);
  saveVocabulary(vocab);
}

/** Get all vocabulary entries */
export function getAllTerms(): VocabularyEntry[] {
  return loadVocabulary();
}

/** Get terms filtered by category */
export function getTermsByCategory(category: VocabularyEntry['category']): VocabularyEntry[] {
  return loadVocabulary().filter(v => v.category === category);
}

/** 
 * Generate a hotwords string for Whisper.
 * Format: comma-separated list of terms.
 */
export function getHotwordsString(): string {
  return loadVocabulary().map(v => v.term).join(', ');
}

/** Get vocabulary statistics */
export function getVocabularyStats(): VocabularyStats {
  const vocab = loadVocabulary();
  const byCategory: Record<string, number> = {};
  
  for (const v of vocab) {
    byCategory[v.category] = (byCategory[v.category] || 0) + 1;
  }
  
  return {
    totalTerms: vocab.length,
    byCategory,
    hotwordsString: getHotwordsString(),
  };
}

/** Clear all vocabulary */
export function clearVocabulary(): void {
  localStorage.removeItem(VOCAB_KEY);
}

/** Export vocabulary as JSON */
export function exportVocabulary(): string {
  return JSON.stringify(loadVocabulary(), null, 2);
}

/** Import vocabulary from JSON, returns count of added entries */
export function importVocabulary(json: string): number {
  try {
    const imported = JSON.parse(json) as VocabularyEntry[];
    if (!Array.isArray(imported)) return -1;
    
    const vocab = loadVocabulary();
    const existingTerms = new Set(vocab.map(v => v.term));
    let added = 0;
    
    for (const entry of imported) {
      if (!entry.term || existingTerms.has(entry.term)) continue;
      vocab.push({
        term: entry.term,
        variants: entry.variants || [],
        category: entry.category || 'other',
        usageCount: entry.usageCount || 0,
        createdAt: entry.createdAt || Date.now(),
      });
      existingTerms.add(entry.term);
      added++;
    }
    
    saveVocabulary(vocab);
    return added;
  } catch {
    return -1;
  }
}

/**
 * Apply vocabulary corrections to text.
 * Replaces known variants with the correct term.
 */
export function applyVocabularyCorrections(text: string): { text: string; appliedCount: number } {
  const vocab = loadVocabulary();
  let result = text;
  let applied = 0;
  
  for (const entry of vocab) {
    for (const variant of entry.variants) {
      if (variant && result.includes(variant)) {
        result = result.split(variant).join(entry.term);
        applied++;
        // Increment usage count
        entry.usageCount++;
      }
    }
  }
  
  if (applied > 0) {
    saveVocabulary(vocab);
  }
  
  return { text: result, appliedCount: applied };
}
