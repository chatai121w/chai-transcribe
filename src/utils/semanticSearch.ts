/**
 * Bilingual Semantic Search for Hebrew/English transcripts.
 * Uses TF-IDF based cosine similarity with Hebrew-aware tokenization.
 * No external API needed — runs entirely in-browser.
 */

// Hebrew stop words to ignore during search
const HEBREW_STOP_WORDS = new Set([
  'של', 'את', 'על', 'עם', 'הוא', 'היא', 'הם', 'הן', 'אני', 'אתה', 'את',
  'אנחנו', 'אתם', 'אתן', 'זה', 'זו', 'זאת', 'אלה', 'אלו', 'כל', 'כי',
  'לא', 'גם', 'אם', 'או', 'אבל', 'רק', 'עוד', 'כן', 'מה', 'מי', 'איך',
  'למה', 'מתי', 'איפה', 'אז', 'פה', 'שם', 'כאן', 'שם', 'אחרי', 'לפני',
  'בין', 'תחת', 'מעל', 'ליד', 'דרך', 'בלי', 'עד', 'מן', 'אל',
  'ה', 'ו', 'ב', 'ל', 'מ', 'כ', 'ש',
]);

const ENGLISH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'shall',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
  'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'and', 'or', 'but', 'if', 'so',
  'not', 'no', 'at', 'by', 'for', 'in', 'of', 'on', 'to', 'with', 'from',
]);

/**
 * Tokenize text with Hebrew-aware processing.
 * Strips prefixes (ה, ו, ב, ל, מ, כ, ש) from Hebrew words.
 */
function tokenize(text: string): string[] {
  // Split on non-word characters, keeping Hebrew and English
  const rawTokens = text.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);

  const tokens: string[] = [];
  for (const token of rawTokens) {
    // Skip stop words
    if (HEBREW_STOP_WORDS.has(token) || ENGLISH_STOP_WORDS.has(token)) continue;

    tokens.push(token);

    // For Hebrew words, also add the stem without common single-char prefixes
    if (/[\u0590-\u05FF]/.test(token) && token.length > 2) {
      const firstChar = token[0];
      if ('הובלמכש'.includes(firstChar)) {
        const stem = token.slice(1);
        if (stem.length > 1) tokens.push(stem);
      }
    }
  }
  return tokens;
}

/** Build a TF (term frequency) map from tokens. */
function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1);
  }
  // Normalize by total count
  const total = tokens.length || 1;
  for (const [k, v] of tf) {
    tf.set(k, v / total);
  }
  return tf;
}

/** Cosine similarity between two TF vectors. */
function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [key, val] of a) {
    normA += val * val;
    const bVal = b.get(key);
    if (bVal !== undefined) {
      dotProduct += val * bVal;
    }
  }
  for (const val of b.values()) {
    normB += val * val;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

export interface SemanticSearchResult {
  index: number;
  score: number;
  snippet: string;
}

/**
 * Search through documents using bilingual semantic similarity.
 * Returns results sorted by relevance score.
 */
export function semanticSearch(
  query: string,
  documents: string[],
  topK: number = 10,
  minScore: number = 0.05
): SemanticSearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const queryTf = termFrequency(queryTokens);

  const results: SemanticSearchResult[] = [];

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (!doc.trim()) continue;

    const docTokens = tokenize(doc);
    const docTf = termFrequency(docTokens);
    const score = cosineSimilarity(queryTf, docTf);

    if (score >= minScore) {
      // Extract a relevant snippet (first 200 chars containing a query term)
      const lowerDoc = doc.toLowerCase();
      const firstMatch = queryTokens.find(t => lowerDoc.includes(t));
      let snippet: string;
      if (firstMatch) {
        const idx = lowerDoc.indexOf(firstMatch);
        const start = Math.max(0, idx - 50);
        const end = Math.min(doc.length, idx + 150);
        snippet = (start > 0 ? '...' : '') + doc.slice(start, end) + (end < doc.length ? '...' : '');
      } else {
        snippet = doc.slice(0, 200) + (doc.length > 200 ? '...' : '');
      }

      results.push({ index: i, score, snippet });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
