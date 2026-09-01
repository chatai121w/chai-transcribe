import { replaceWholeTextOccurrences } from '@/lib/hebrewTextReplacement';
import { TORAH_LEXICON_SEED } from '@/data/torahLexiconSeed';

/**
 * Custom Vocabulary System
 * 
 * Manages a personal dictionary of terms, names, and phrases that
 * should be recognized correctly in transcriptions. Feeds into
 * Whisper hotwords and correction learning.
 */

export type VocabularyCategory =
  | 'tractate' | 'tanna' | 'amora' | 'commentator' | 'aramaic' | 'rabbinic_book' | 'concept'
  | 'name' | 'place' | 'technical' | 'organization' | 'other';

export type VocabularySource = 'built-in' | 'user' | 'approved-correction' | 'import';
export type VocabularyApprovalStatus = 'verified' | 'candidate' | 'rejected';

export interface VocabularyEntry {
  /** The correct term/name */
  term: string;
  /** Optional: common misheard variants */
  variants: string[];
  /** Category for organization */
  category: VocabularyCategory;
  /** How often this term appears in transcriptions */
  usageCount: number;
  /** When added */
  createdAt: number;
  /** Last meaningful update, used when local/cloud copies are merged. */
  updatedAt: number;
  /** Optional normalized pronunciation hint. */
  pronunciation?: string;
  /** Contexts that should increase this term's ASR priority. */
  contextTags: string[];
  /** Provenance keeps built-in knowledge separate from user-approved learning. */
  source: VocabularySource;
  /** Candidate terms never become automatic replacements. */
  approvalStatus: VocabularyApprovalStatus;
  /** Confidence in the canonical spelling, in the range 0..1. */
  confidence: number;
  notes?: string;
}

export type VocabularyMetadata = Partial<Pick<
  VocabularyEntry,
  'pronunciation' | 'contextTags' | 'source' | 'approvalStatus' | 'confidence' | 'notes'
>>;

export interface VocabularyStats {
  totalTerms: number;
  byCategory: Record<string, number>;
  hotwordsString: string;
}

const VOCAB_KEY = 'custom_vocabulary';
const VOCAB_ENABLED_KEY = 'custom_vocabulary_enabled';
const VOCAB_SEED_VERSION_KEY = 'custom_vocabulary_torah_seed_version';
const VOCAB_SEED_VERSION = '2';
export const VOCABULARY_CHANGED_EVENT = 'custom-vocabulary-changed';

export function isCustomVocabularyEnabled(): boolean {
  try {
    return localStorage.getItem(VOCAB_ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

export function setCustomVocabularyEnabled(enabled: boolean): void {
  localStorage.setItem(VOCAB_ENABLED_KEY, enabled ? '1' : '0');
}

export function normalizeVocabularyKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u05F3\u05F4"']/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('he');
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const clean = value.trim().replace(/\s+/g, ' ');
    const key = normalizeVocabularyKey(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function normalizeEntry(entry: Partial<VocabularyEntry>): VocabularyEntry | null {
  const term = typeof entry.term === 'string' ? entry.term.trim().replace(/\s+/g, ' ') : '';
  if (!term) return null;
  const createdAt = Number.isFinite(entry.createdAt) ? Number(entry.createdAt) : Date.now();
  const confidence = Number.isFinite(entry.confidence) ? Number(entry.confidence) : 1;
  return {
    term,
    variants: uniqueStrings(entry.variants),
    category: entry.category || 'other',
    usageCount: Math.max(0, Number(entry.usageCount) || 0),
    createdAt,
    updatedAt: Number.isFinite(entry.updatedAt) ? Number(entry.updatedAt) : createdAt,
    pronunciation: typeof entry.pronunciation === 'string' ? entry.pronunciation.trim() || undefined : undefined,
    contextTags: uniqueStrings(entry.contextTags),
    source: entry.source || 'user',
    approvalStatus: entry.approvalStatus || 'verified',
    confidence: Math.max(0, Math.min(1, confidence)),
    notes: typeof entry.notes === 'string' ? entry.notes.trim() || undefined : undefined,
  };
}

function loadVocabulary(): VocabularyEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(VOCAB_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return mergeVocabularyEntries(parsed.map(normalizeEntry).filter(Boolean) as VocabularyEntry[]);
  } catch {
    return [];
  }
}

function saveVocabulary(entries: VocabularyEntry[]): void {
  localStorage.setItem(VOCAB_KEY, JSON.stringify(mergeVocabularyEntries(entries)));
  try { window.dispatchEvent(new CustomEvent(VOCABULARY_CHANGED_EVENT)); } catch { /* non-browser/test */ }
}

/** Merge local, built-in and cloud entries by one normalized canonical key. */
export function mergeVocabularyEntries(...groups: VocabularyEntry[][]): VocabularyEntry[] {
  const merged = new Map<string, VocabularyEntry>();
  for (const entry of groups.flat()) {
    const normalized = normalizeEntry(entry);
    if (!normalized) continue;
    const key = normalizeVocabularyKey(normalized.term);
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, normalized);
      continue;
    }
    const newer = normalized.updatedAt >= previous.updatedAt ? normalized : previous;
    const older = newer === normalized ? previous : normalized;
    merged.set(key, {
      ...older,
      ...newer,
      variants: uniqueStrings([...previous.variants, ...normalized.variants]),
      contextTags: uniqueStrings([...previous.contextTags, ...normalized.contextTags]),
      usageCount: Math.max(previous.usageCount, normalized.usageCount),
      confidence: Math.max(previous.confidence, normalized.confidence),
    });
  }
  const entries = Array.from(merged.values());
  const canonicalKeys = new Set(entries.map(entry => normalizeVocabularyKey(entry.term)));
  const claimedVariants = new Set<string>();
  const claimOrder = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const sourcePriority = (entry: VocabularyEntry) =>
        entry.source === 'approved-correction' ? 3 : entry.source === 'user' ? 2 : entry.source === 'import' ? 1 : 0;
      return sourcePriority(b.entry) - sourcePriority(a.entry)
        || Number(b.entry.approvalStatus === 'verified') - Number(a.entry.approvalStatus === 'verified')
        || b.entry.confidence - a.entry.confidence
        || b.entry.updatedAt - a.entry.updatedAt;
    });

  const variantsByIndex = new Map<number, string[]>();
  for (const { entry, index } of claimOrder) {
    const variants = entry.variants.filter(variant => {
      const key = normalizeVocabularyKey(variant);
      if (!key || canonicalKeys.has(key) || claimedVariants.has(key)) return false;
      claimedVariants.add(key);
      return true;
    });
    variantsByIndex.set(index, variants);
  }

  return entries.map((entry, index) => ({ ...entry, variants: variantsByIndex.get(index) || [] }));
}

/** Add a new term to the vocabulary */
export function addTerm(
  term: string,
  category: VocabularyEntry['category'] = 'other',
  variants: string[] = [],
  metadata: VocabularyMetadata = {},
): boolean {
  const vocab = loadVocabulary();
  const trimmed = term.trim();
  if (!trimmed) return false;
  
  // Check for duplicates
  if (vocab.some(v => normalizeVocabularyKey(v.term) === normalizeVocabularyKey(trimmed))) return false;
  const now = Date.now();
  
  vocab.push({
    term: trimmed,
    variants: uniqueStrings(variants),
    category,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
    pronunciation: metadata.pronunciation?.trim() || undefined,
    contextTags: uniqueStrings(metadata.contextTags),
    source: metadata.source || 'user',
    approvalStatus: metadata.approvalStatus || 'verified',
    confidence: Math.max(0, Math.min(1, metadata.confidence ?? 1)),
    notes: metadata.notes?.trim() || undefined,
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
  const existingTerms = new Set(vocab.map(v => normalizeVocabularyKey(v.term)));
  let added = 0;
  
  for (const raw of terms) {
    const trimmed = raw.trim();
    const key = normalizeVocabularyKey(trimmed);
    if (!trimmed || existingTerms.has(key)) continue;
    vocab.push({
      term: trimmed,
      variants: [],
      category,
      usageCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      contextTags: [],
      source: 'user',
      approvalStatus: 'verified',
      confidence: 1,
    });
    existingTerms.add(key);
    added++;
  }
  
  saveVocabulary(vocab);
  return added;
}

/** Update an existing term */
export function updateTerm(
  originalTerm: string,
  updates: Partial<Pick<VocabularyEntry, 'term' | 'category' | 'variants' | 'pronunciation' | 'contextTags' | 'approvalStatus' | 'confidence' | 'notes'>>
): boolean {
  const vocab = loadVocabulary();
  const idx = vocab.findIndex(v => normalizeVocabularyKey(v.term) === normalizeVocabularyKey(originalTerm));
  if (idx < 0) return false;
  
  if (updates.term !== undefined) {
    const next = updates.term.trim();
    if (vocab.some((v, i) => i !== idx && normalizeVocabularyKey(v.term) === normalizeVocabularyKey(next))) return false;
    vocab[idx].term = next;
  }
  if (updates.category !== undefined) vocab[idx].category = updates.category;
  if (updates.variants !== undefined) vocab[idx].variants = uniqueStrings(updates.variants);
  if (updates.contextTags !== undefined) vocab[idx].contextTags = uniqueStrings(updates.contextTags);
  if (updates.pronunciation !== undefined) vocab[idx].pronunciation = updates.pronunciation.trim() || undefined;
  if (updates.approvalStatus !== undefined) vocab[idx].approvalStatus = updates.approvalStatus;
  if (updates.confidence !== undefined) vocab[idx].confidence = Math.max(0, Math.min(1, updates.confidence));
  if (updates.notes !== undefined) vocab[idx].notes = updates.notes.trim() || undefined;
  vocab[idx].updatedAt = Date.now();
  
  saveVocabulary(vocab);
  return true;
}

/** Remove a term */
export function removeTerm(term: string): void {
  const key = normalizeVocabularyKey(term);
  const vocab = loadVocabulary().filter(v => normalizeVocabularyKey(v.term) !== key);
  saveVocabulary(vocab);
}

/** Get all vocabulary entries */
export function getAllTerms(): VocabularyEntry[] {
  return loadVocabulary();
}

/** Merge cloud/imported entries through the same canonical deduplication path. */
export function mergeVocabularyFromExternal(entries: VocabularyEntry[]): number {
  const before = loadVocabulary();
  const beforeByKey = new Map(before.map(entry => [normalizeVocabularyKey(entry.term), JSON.stringify(entry)]));
  const merged = mergeVocabularyEntries(before, entries);
  saveVocabulary(merged);
  return merged.filter(entry => beforeByKey.get(normalizeVocabularyKey(entry.term)) !== JSON.stringify(entry)).length;
}

/** Built-in terms ship with the app; only personal knowledge needs cloud rows. */
export function getCloudSyncableTerms(): VocabularyEntry[] {
  return loadVocabulary().filter(entry => entry.source !== 'built-in');
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
  return loadVocabulary()
    .filter(v => v.approvalStatus !== 'rejected')
    .map(v => v.term)
    .join(', ');
}

/** Rank canonical terms for the current recording without duplicating other hotword sources. */
export function getRankedVocabularyTerms(context = '', limit = 100): VocabularyEntry[] {
  const normalizedContext = normalizeVocabularyKey(context);
  return loadVocabulary()
    .filter(entry => entry.approvalStatus !== 'rejected')
    .map((entry, order) => {
      const termKey = normalizeVocabularyKey(entry.term);
      const termMatch = termKey.length >= 2 && normalizedContext.includes(termKey);
      const tagMatch = entry.contextTags.some(tag => {
        const tagKey = normalizeVocabularyKey(tag);
        return tagKey.length >= 3 && normalizedContext.includes(tagKey);
      });
      const verifiedBoost = entry.approvalStatus === 'verified' ? 100 : 0;
      const sourceBoost = entry.source === 'user' || entry.source === 'approved-correction' ? 80 : 0;
      return { entry, order, score: (termMatch ? 500 : 0) + (tagMatch ? 150 : 0) + verifiedBoost + sourceBoost + entry.confidence * 100 + Math.min(100, entry.usageCount) };
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, Math.max(0, limit))
    .map(item => item.entry);
}

/** Add/update the built-in Torah corpus once, preserving every existing user entry. */
export function seedTorahLexicon(force = false): number {
  try {
    if (!force && localStorage.getItem(VOCAB_SEED_VERSION_KEY) === VOCAB_SEED_VERSION) return 0;
    const personalEntries = loadVocabulary().filter(entry => entry.source !== 'built-in');
    const existingKeys = new Set(personalEntries.map(entry => normalizeVocabularyKey(entry.term)));
    const now = Date.now();
    const additions: VocabularyEntry[] = [];
    for (const seed of TORAH_LEXICON_SEED) {
      const key = normalizeVocabularyKey(seed.term);
      if (!key || existingKeys.has(key)) continue;
      additions.push({
        term: seed.term,
        variants: uniqueStrings(seed.variants),
        category: seed.category,
        usageCount: 0,
        createdAt: now,
        updatedAt: now,
        pronunciation: seed.pronunciation,
        contextTags: uniqueStrings(seed.contextTags),
        source: 'built-in',
        approvalStatus: 'verified',
        confidence: 1,
      });
      existingKeys.add(key);
    }
    saveVocabulary([...personalEntries, ...additions]);
    localStorage.setItem(VOCAB_SEED_VERSION_KEY, VOCAB_SEED_VERSION);
    return additions.length;
  } catch {
    return 0;
  }
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

/** Clear personal vocabulary while preserving the single built-in Torah corpus. */
export function clearVocabulary(): void {
  const builtIns = loadVocabulary().filter(entry => entry.source === 'built-in');
  saveVocabulary(builtIns);
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
    const existingTerms = new Set(vocab.map(v => normalizeVocabularyKey(v.term)));
    let added = 0;
    
    for (const entry of imported) {
      const normalized = normalizeEntry({ ...entry, source: entry.source || 'import' });
      const key = normalizeVocabularyKey(normalized?.term || '');
      if (!entry.term || existingTerms.has(key)) continue;
      if (!normalized) continue;
      vocab.push(normalized);
      existingTerms.add(key);
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
    if (entry.approvalStatus !== 'verified' || entry.confidence < 0.85) continue;
    for (const variant of entry.variants) {
      if (variant) {
        const replacement = replaceWholeTextOccurrences(result, variant, entry.term);
        if (replacement.count === 0) continue;
        result = replacement.text;
        applied += replacement.count;
        // Increment usage count
        entry.usageCount += replacement.count;
        entry.updatedAt = Date.now();
      }
    }
  }
  
  if (applied > 0) {
    saveVocabulary(vocab);
  }
  
  return { text: result, appliedCount: applied };
}
