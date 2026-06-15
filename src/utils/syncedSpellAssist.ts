import { getSuspectWordsMap, type SpellSuggestion } from "@/utils/hebrewSpellCheck";
import { getDictionaryReplacements, isIgnoredWord } from "@/utils/hebrewGrammarDictionary";

export type MarkMode = "underline" | "highlight";

export interface SyncedSpellAssistSettings {
  enabled: boolean;
  grammarEnabled: boolean;
  duplicateWordsRule: boolean;
  punctuationRule: boolean;
  latinWordsRule: boolean;
  useDictionary: boolean;
  markMode: MarkMode;
  markColor: string;
  keepMarkedAfterFix: boolean;
}

export interface MenuSuggestion {
  label?: string;
  text: string;
  source: string;
  score: number;
}

function normalizeWord(word: string): string {
  return word.replace(/[.,;:!?"'׳״()\[\]{}<>\-–—]/g, "").trim().toLowerCase();
}

function dedupeAndRank(suggestions: MenuSuggestion[], cleanWord: string): MenuSuggestion[] {
  const unique = suggestions.filter((s, idx, arr) => {
    const replacement = (s.text || "").trim();
    const sameAsWord = replacement && replacement !== "__DELETE__" && normalizeWord(replacement) === cleanWord;
    if (sameAsWord) return false;
    return arr.findIndex((x) => `${x.source}:${x.text}` === `${s.source}:${s.text}`) === idx;
  });

  return unique
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export function buildIssueMap(
  words: string[],
  settings: SyncedSpellAssistSettings,
  stickyMarked: Set<number>,
): Map<number, MenuSuggestion[]> {
  const map = new Map<number, MenuSuggestion[]>();
  if (!settings.enabled || !words.length) return map;

  const suspectWordsMap = getSuspectWordsMap(words.join(" "));

  for (let i = 0; i < words.length; i += 1) {
    const originalWord = words[i] || "";
    const clean = normalizeWord(originalWord);
    if (!clean) continue;

    if (settings.useDictionary && isIgnoredWord(clean)) {
      continue;
    }

    const suggestions: MenuSuggestion[] = [];

    const baseSpellSuggestions = suspectWordsMap.get(clean) || [];
    baseSpellSuggestions.forEach((s: SpellSuggestion) => {
      const score = s.source === "learned" ? 0.95 : s.source === "vocabulary" ? 0.85 : 0.7;
      suggestions.push({ text: s.text, source: s.source, score });
    });

    if (settings.useDictionary) {
      const dictReplacements = getDictionaryReplacements(clean);
      dictReplacements.forEach((r) => {
        suggestions.push({ text: r, source: "dictionary", score: 0.99 });
      });
    }

    if (settings.grammarEnabled && settings.duplicateWordsRule && i > 0) {
      const prev = normalizeWord(words[i - 1]);
      if (prev && clean === prev) {
        suggestions.push({ label: "מחק מילה כפולה", text: "__DELETE__", source: "grammar-duplicate", score: 1.0 });
      }
    }

    if (settings.grammarEnabled && settings.punctuationRule) {
      if (/([!?.,])\1{1,}/.test(originalWord)) {
        const fixed = originalWord.replace(/([!?.,])\1{1,}/g, "$1");
        suggestions.push({ text: fixed, source: "grammar-punctuation", score: 0.82 });
      }
    }

    if (settings.grammarEnabled && settings.latinWordsRule) {
      const hasLatin = /[A-Za-z]/.test(originalWord);
      const hasHebrew = /[\u0590-\u05FF]/.test(originalWord);
      if (hasLatin && !hasHebrew) {
        suggestions.push({ label: "אשר כמונח תקין במילון", text: "__IGNORE__", source: "grammar-latin", score: 0.5 });
      }
    }

    const ranked = dedupeAndRank(suggestions, clean);
    if (ranked.length > 0) {
      map.set(i, ranked);
    }
  }

  stickyMarked.forEach((idx) => {
    if (!map.has(idx) && idx >= 0 && idx < words.length) {
      map.set(idx, [{ text: words[idx], source: "fixed-marker", score: 0.2 }]);
    }
  });

  return map;
}
