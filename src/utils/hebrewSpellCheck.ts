/**
 * Hebrew Spell Check System
 * 
 * Identifies suspect words in Hebrew text using:
 * 1. Correction learning database (previously corrected words)
 * 2. Custom vocabulary variants (known misspellings)
 * 3. Hebrew linguistic heuristics
 * 
 * Provides suggestions from learned corrections, vocabulary, and edit distance.
 */

import { getAllCorrections, type CorrectionEntry } from './correctionLearning';
import { getAllTerms, type VocabularyEntry } from './customVocabulary';

export interface SpellSuggestion {
  text: string;
  source: 'learned' | 'vocabulary' | 'similar';
  confidence: number;
}

export interface SuspectWord {
  word: string;
  index: number;       // character index in the plain text
  suggestions: SpellSuggestion[];
  reason: 'correction' | 'variant' | 'pattern';
}

// Common Hebrew words that should never be flagged
const COMMON_HEBREW_WORDS = new Set([
  'את', 'של', 'על', 'עם', 'אל', 'מן', 'כי', 'גם', 'לא', 'כל',
  'הוא', 'היא', 'הם', 'הן', 'אני', 'אתה', 'את', 'אנחנו', 'אתם', 'אתן',
  'זה', 'זו', 'זאת', 'אלה', 'אלו', 'מה', 'מי', 'איך', 'למה', 'איפה',
  'כבר', 'עוד', 'רק', 'אם', 'או', 'אבל', 'אז', 'כן', 'בו', 'בה',
  'לו', 'לה', 'בא', 'יש', 'אין', 'היה', 'היתה', 'היו', 'יהיה', 'תהיה',
  'שם', 'פה', 'כאן', 'שם', 'עכשיו', 'אחר', 'כך', 'כמו', 'בין', 'לפני',
  'אחרי', 'בלי', 'עד', 'מול', 'תחת', 'דרך', 'בגלל', 'למען', 'כדי',
  'ה', 'ו', 'ב', 'ל', 'מ', 'כ', 'ש',
  'טוב', 'רע', 'גדול', 'קטן', 'חדש', 'ישן', 'יפה', 'הרבה', 'מאוד',
  'אחד', 'שני', 'שלישי', 'ראשון', 'כמה', 'הרבה', 'קצת', 'מעט',
  'יום', 'לילה', 'שנה', 'חודש', 'שבוע', 'שעה', 'דקה', 'זמן',
  'אדם', 'איש', 'אישה', 'ילד', 'ילדה', 'בן', 'בת', 'אב', 'אם',
  'בית', 'עיר', 'מקום', 'ארץ', 'דבר', 'דברים', 'פעם',
  'אמר', 'אומר', 'עשה', 'עושה', 'בא', 'הלך', 'ראה', 'רואה', 'נתן',
  'לקח', 'שמע', 'ידע', 'יודע', 'רוצה', 'צריך', 'יכול',
  'כתב', 'קרא', 'למד', 'חשב', 'שאל',
  // Common religious/Torah terms
  'תורה', 'משה', 'ישראל', 'השם', 'ברוך', 'אלוהים', 'מצוה', 'מצוות',
  'שבת', 'חג', 'תפילה', 'ברכה', 'קדוש', 'מועד', 'ראש',
  'הלכה', 'מדרש', 'תלמוד', 'משנה', 'גמרא', 'רבי', 'רב',
]);

// Hebrew character range check
const HEBREW_CHAR_RE = /[\u0590-\u05FF]/;
const HEBREW_WORD_RE = /^[\u0590-\u05FF\u200F\u200E'"״׳-]+$/;
const PUNCTUATION_RE = /^[.,;:!?"""''׳״\-–—()[\]{}/'\\]+$/;
const NUMBER_RE = /^\d+$/;

/**
 * Calculate edit distance (Levenshtein) between two strings.
 */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Find similar words from a vocabulary using edit distance.
 */
function findSimilarWords(word: string, knownWords: string[], maxDistance: number = 2): SpellSuggestion[] {
  const suggestions: SpellSuggestion[] = [];
  const normalizedWord = word.replace(/['"״׳]/g, '');
  
  for (const known of knownWords) {
    if (known === word) continue;
    const normalizedKnown = known.replace(/['"״׳]/g, '');
    const dist = editDistance(normalizedWord, normalizedKnown);
    if (dist > 0 && dist <= maxDistance && dist < normalizedWord.length * 0.5) {
      suggestions.push({
        text: known,
        source: 'similar',
        confidence: 1 - (dist / Math.max(normalizedWord.length, normalizedKnown.length)),
      });
    }
  }
  
  return suggestions.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}

/**
 * Build a set of "known good" words from corrections (corrected side) and vocabulary terms.
 */
function buildKnownWordsSet(corrections: CorrectionEntry[], vocabulary: VocabularyEntry[]): Set<string> {
  const known = new Set<string>(COMMON_HEBREW_WORDS);
  
  // Add corrected words (the good version)
  for (const c of corrections) {
    if (c.corrected) {
      c.corrected.split(/\s+/).forEach(w => known.add(w.trim()));
    }
  }
  
  // Add vocabulary terms
  for (const v of vocabulary) {
    known.add(v.term.trim());
  }
  
  return known;
}

/**
 * Check if a word is a suspect/misspelled word.
 * Returns suggestions if suspect, empty array if OK.
 */
function checkWord(
  word: string,
  corrections: CorrectionEntry[],
  vocabulary: VocabularyEntry[],
  knownGoodWords: string[],
): SpellSuggestion[] {
  const suggestions: SpellSuggestion[] = [];
  const trimmed = word.trim().replace(/[^\u0590-\u05FFa-zA-Z0-9]/g, '');
  if (!trimmed) return [];
  
  // 1. Check if word matches a known correction "original" (known error)
  for (const c of corrections) {
    const origWords = c.original.split(/\s+/);
    if (origWords.includes(trimmed) || c.original === trimmed) {
      suggestions.push({
        text: c.corrected,
        source: 'learned',
        confidence: c.confidence,
      });
    }
  }
  
  // 2. Check if word matches a vocabulary variant (known misspelling)
  for (const v of vocabulary) {
    if (v.variants.some(variant => variant === trimmed)) {
      suggestions.push({
        text: v.term,
        source: 'vocabulary',
        confidence: 0.9,
      });
    }
  }
  
  // 3. If found in corrections/variants, also find similar words
  if (suggestions.length > 0) {
    const similar = findSimilarWords(trimmed, knownGoodWords, 2);
    // Only add similar suggestions that aren't already in the list
    const existingTexts = new Set(suggestions.map(s => s.text));
    for (const s of similar) {
      if (!existingTexts.has(s.text)) {
        suggestions.push(s);
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return suggestions.filter(s => {
    if (seen.has(s.text) || s.text === trimmed) return false;
    seen.add(s.text);
    return true;
  }).slice(0, 6);
}

/**
 * Main spell check function.
 * Analyzes text and returns list of suspect words with suggestions.
 */
export function spellCheckText(text: string): SuspectWord[] {
  if (!text || text.trim().length < 2) return [];
  
  const corrections = getAllCorrections();
  const vocabulary = getAllTerms();
  const knownWords = buildKnownWordsSet(corrections, vocabulary);
  const knownGoodArray = Array.from(knownWords);
  
  // Build set of known error words for quick lookup
  const knownErrorWords = new Set<string>();
  for (const c of corrections) {
    if (c.confidence >= 0.4) {
      c.original.split(/\s+/).forEach(w => knownErrorWords.add(w.trim()));
    }
  }
  
  // Build set of vocabulary variants for quick lookup
  const variantSet = new Set<string>();
  for (const v of vocabulary) {
    v.variants.forEach(variant => variantSet.add(variant.trim()));
  }
  
  const suspects: SuspectWord[] = [];
  
  // Split text into words with their positions
  const wordRegex = /\S+/g;
  let match: RegExpExecArray | null;
  
  while ((match = wordRegex.exec(text)) !== null) {
    const rawWord = match[0];
    const cleanWord = rawWord.replace(/[^\u0590-\u05FFa-zA-Z0-9]/g, '');
    
    // Skip empty, numbers, punctuation-only
    if (!cleanWord || PUNCTUATION_RE.test(rawWord) || NUMBER_RE.test(cleanWord)) continue;
    
    // Skip very short words (1-2 chars) unless they're known errors
    if (cleanWord.length <= 2 && !knownErrorWords.has(cleanWord) && !variantSet.has(cleanWord)) continue;
    
    // Skip common Hebrew words
    if (COMMON_HEBREW_WORDS.has(cleanWord)) continue;
    
    // Skip non-Hebrew words (Latin, etc.)
    if (!HEBREW_CHAR_RE.test(cleanWord)) continue;
    
    // Skip words that are in the known good set
    if (knownWords.has(cleanWord)) continue;
    
    // Check if it's a known error or variant
    const isKnownError = knownErrorWords.has(cleanWord);
    const isVariant = variantSet.has(cleanWord);
    
    if (isKnownError || isVariant) {
      const suggestions = checkWord(cleanWord, corrections, vocabulary, knownGoodArray);
      if (suggestions.length > 0) {
        suspects.push({
          word: rawWord,
          index: match.index,
          suggestions,
          reason: isKnownError ? 'correction' : 'variant',
        });
      }
    }
  }
  
  return suspects;
}

/**
 * Get the suspect words as a Set for quick lookup (word → suggestions).
 */
export function getSuspectWordsMap(text: string): Map<string, SpellSuggestion[]> {
  const suspects = spellCheckText(text);
  const map = new Map<string, SpellSuggestion[]>();
  for (const s of suspects) {
    const clean = s.word.replace(/[^\u0590-\u05FFa-zA-Z0-9]/g, '');
    if (clean) map.set(clean, s.suggestions);
  }
  return map;
}
