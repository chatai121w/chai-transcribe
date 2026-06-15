/**
 * DICTA Hebrew NLP API integration
 * - Nakdan: automatic nikud (vocalization) for Hebrew text
 * - Morph: morphological analysis and grammar checking
 * Docs: https://dicta.org.il/
 */

const DICTA_NAKDAN_URL = "https://nakdan-5-1.loadbalancer.dicta.org.il/api";
const DICTA_MORPH_URL = "https://morph-analysis.loadbalancer.dicta.org.il/api";

export interface NakdanResult {
  text: string;
  success: boolean;
  error?: string;
}

export interface MorphWord {
  word: string;
  lemma: string;
  pos: string; // Part of speech
  morph: string; // Morphological features
  prefixes?: string[];
}

export interface MorphResult {
  words: MorphWord[];
  success: boolean;
  error?: string;
}

/**
 * Add nikud (vocalization) to Hebrew text using DICTA Nakdan API.
 * This is free and does not require an API key.
 */
export async function addNikud(text: string): Promise<NakdanResult> {
  if (!text.trim()) return { text: '', success: true };

  try {
    const response = await fetch(DICTA_NAKDAN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: text,
        genre: "modern",      // "modern" | "rabbinic" | "poetry"
        addmorph: false,
        keepaliases: false,
        keepaliasaliases: false,
        keepaliasaliasaliases: false,
        matchaliases: false,
        matchaliasaliases: false,
        keepaliasaliasaliasaliases: false
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Nakdan API error: ${response.status}`);
    }

    const result = await response.json();

    // DICTA returns array of objects with "nakpiresult" and "word" fields
    let nikudText = '';
    if (Array.isArray(result)) {
      nikudText = result
        .map((item: { nakpiresult?: string; word?: string; sep?: string }) =>
          (item.nakpiresult || item.word || '') + (item.sep || ''))
        .join('');
    } else if (typeof result === 'string') {
      nikudText = result;
    } else {
      throw new Error('Unexpected Nakdan response format');
    }

    return { text: nikudText, success: true };
  } catch (err) {
    return {
      text: text,
      success: false,
      error: err instanceof Error ? err.message : 'שגיאה בשרת הניקוד',
    };
  }
}

/**
 * Perform morphological analysis on Hebrew text using DICTA Morph API.
 * Returns lemmas, POS tags, and morphological features for grammar checking.
 */
export async function analyzeMorphology(text: string): Promise<MorphResult> {
  if (!text.trim()) return { words: [], success: true };

  try {
    const response = await fetch(DICTA_MORPH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: text,
        genre: "modern",
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Morph API error: ${response.status}`);
    }

    const result = await response.json();

    const words: MorphWord[] = [];
    if (Array.isArray(result)) {
      for (const item of result) {
        if (item.word) {
          const analysis = Array.isArray(item.options) && item.options.length > 0
            ? item.options[0]
            : {};
          words.push({
            word: item.word,
            lemma: analysis.lemma || item.word,
            pos: analysis.pos || '',
            morph: analysis.morph || '',
            prefixes: analysis.prefixes || [],
          });
        }
      }
    }

    return { words, success: true };
  } catch (err) {
    return {
      words: [],
      success: false,
      error: err instanceof Error ? err.message : 'שגיאה בניתוח מורפולוגי',
    };
  }
}

/**
 * Grammar check: analyze text and return grammar issues/suggestions.
 * Uses DICTA morphological analysis to detect common Hebrew grammar issues.
 */
export async function checkGrammar(text: string): Promise<{
  issues: Array<{ word: string; suggestion: string; type: string }>;
  success: boolean;
  error?: string;
}> {
  const morph = await analyzeMorphology(text);
  if (!morph.success) {
    return { issues: [], success: false, error: morph.error };
  }

  const issues: Array<{ word: string; suggestion: string; type: string }> = [];

  for (const word of morph.words) {
    // Detect prefix segmentation issues (common Hebrew errors)
    if (word.prefixes && word.prefixes.length > 0) {
      const reconstructed = word.prefixes.join('') + word.lemma;
      if (reconstructed !== word.word && word.lemma !== word.word) {
        issues.push({
          word: word.word,
          suggestion: `${word.prefixes.join('+')}+${word.lemma}`,
          type: 'segmentation',
        });
      }
    }
  }

  return { issues, success: true };
}
