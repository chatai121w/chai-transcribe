export interface HebrewGrammarDictionary {
  ignoredWords: string[];
  replacementMap: Record<string, string[]>;
}

const DICT_KEY = "hebrew_grammar_dictionary_v1";

const DEFAULT_DICT: HebrewGrammarDictionary = {
  ignoredWords: [],
  replacementMap: {},
};

function normalizeWord(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?"'׳״()\[\]{}<>\-–—]/g, "");
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function getHebrewGrammarDictionary(): HebrewGrammarDictionary {
  try {
    const raw = localStorage.getItem(DICT_KEY);
    if (!raw) return DEFAULT_DICT;
    const parsed = JSON.parse(raw) as Partial<HebrewGrammarDictionary>;
    return {
      ignoredWords: uniq((parsed.ignoredWords || []).map(normalizeWord)),
      replacementMap: parsed.replacementMap || {},
    };
  } catch {
    return DEFAULT_DICT;
  }
}

export function saveHebrewGrammarDictionary(dict: HebrewGrammarDictionary): void {
  const safe: HebrewGrammarDictionary = {
    ignoredWords: uniq((dict.ignoredWords || []).map(normalizeWord)),
    replacementMap: dict.replacementMap || {},
  };
  localStorage.setItem(DICT_KEY, JSON.stringify(safe));
}

export function isIgnoredWord(word: string): boolean {
  const clean = normalizeWord(word);
  if (!clean) return false;
  const dict = getHebrewGrammarDictionary();
  return dict.ignoredWords.includes(clean);
}

export function getDictionaryReplacements(word: string): string[] {
  const clean = normalizeWord(word);
  if (!clean) return [];
  const dict = getHebrewGrammarDictionary();
  return uniq(dict.replacementMap[clean] || []);
}

export function addIgnoredWord(word: string): void {
  const clean = normalizeWord(word);
  if (!clean) return;
  const dict = getHebrewGrammarDictionary();
  dict.ignoredWords = uniq([...dict.ignoredWords, clean]);
  saveHebrewGrammarDictionary(dict);
}

export function removeIgnoredWord(word: string): void {
  const clean = normalizeWord(word);
  const dict = getHebrewGrammarDictionary();
  dict.ignoredWords = dict.ignoredWords.filter((w) => w !== clean);
  saveHebrewGrammarDictionary(dict);
}

export function addDictionaryReplacement(word: string, replacement: string): void {
  const clean = normalizeWord(word);
  const fixed = replacement.trim();
  if (!clean || !fixed) return;

  const dict = getHebrewGrammarDictionary();
  const current = dict.replacementMap[clean] || [];
  dict.replacementMap[clean] = uniq([fixed, ...current]).slice(0, 10);
  saveHebrewGrammarDictionary(dict);
}
