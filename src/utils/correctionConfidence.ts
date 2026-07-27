/**
 * Correction Confidence Scoring
 *
 * חישוב ציון ביטחון 0-100 לכל זוג תיקון wrong→correct,
 * על בסיס משקלים: לוונשטיין, אורך מילה, חוקים עבריים,
 * הופעה במילון מילים מותאם, ולמידה קודמת.
 */

import { matchesHebrewRule, type RuleHit } from './hebrewRuleEngine';

export interface ConfidenceBreakdown {
  total: number; // 0-100
  parts: {
    levenshtein: number;
    phonetic: number;
    occurrences: number;
    wordLength: number;
    ruleEngine: number;
    vocabulary: number;
    aiReview: number;
  };
  ruleHit: RuleHit | null;
}

const HEBREW_NIKUD = /[\u0591-\u05C7]/g;
const stripNikud = (s: string) => s.replace(HEBREW_NIKUD, '');

// ─── Levenshtein ───────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    let curr = i;
    let pi = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr = Math.min(tmp + 1, prev[j - 1] + 1, pi + cost);
      pi = tmp;
      prev[j] = curr;
    }
  }
  return prev[n];
}

// ─── Phonetic similarity (פשוט מאוד — קבוצות עיצורים דומים) ────────────
const PHONETIC_GROUPS: Record<string, string> = {
  'א': '1', 'ע': '1', 'ה': '1',
  'ב': '2', 'ו': '2', 'פ': '3', 'ף': '3',
  'ג': '4', 'כ': '4', 'ך': '4', 'ק': '4',
  'ד': '5', 'ט': '5', 'ת': '5',
  'ז': '6', 'ס': '6', 'ש': '6', 'צ': '6', 'ץ': '6',
  'ח': '7',
  'י': '8',
  'ל': '9',
  'מ': 'A', 'ם': 'A', 'נ': 'A', 'ן': 'A',
  'ר': 'B',
};

function toPhonetic(word: string): string {
  const stripped = stripNikud(word);
  let out = '';
  let last = '';
  for (const ch of stripped) {
    const code = PHONETIC_GROUPS[ch] ?? ch;
    if (code !== last) out += code;
    last = code;
  }
  return out;
}

function phoneticSimilarity(a: string, b: string): number {
  const pa = toPhonetic(a);
  const pb = toPhonetic(b);
  if (!pa || !pb) return 0;
  const dist = levenshtein(pa, pb);
  const max = Math.max(pa.length, pb.length);
  return 1 - dist / max;
}

// ─── Main scorer ───────────────────────────────────────────────────────
export interface ScoreInput {
  wrong: string;
  correct: string;
  occurrences?: number;
  inVocabulary?: boolean;       // המילה הנכונה נמצאת במילון מותאם / תיקונים נלמדים
  aiConfidence?: number | null; // 0-1 מ-AI review (אופציונלי)
}

export function scoreCorrection(input: ScoreInput): ConfidenceBreakdown {
  const wrong = stripNikud(input.wrong.trim());
  const correct = stripNikud(input.correct.trim());
  const occ = Math.max(1, input.occurrences ?? 1);

  // 1. Levenshtein (משקל 25)
  const dist = levenshtein(wrong, correct);
  const maxLen = Math.max(wrong.length, correct.length, 1);
  const levSim = 1 - dist / maxLen;
  const levenshteinScore = Math.max(0, Math.min(25, levSim * 25));

  // 2. דמיון פונטי (משקל 20)
  const phonScore = Math.max(0, Math.min(20, phoneticSimilarity(wrong, correct) * 20));

  // 3. מספר הופעות (משקל 15)
  const occScore = Math.min(15, (Math.min(occ, 4) / 4) * 15);

  // 4. אורך מילה (משקל 10) — מילים ארוכות = פחות סיכוי לטעות מקרית
  const lenNorm = Math.min(correct.length, 8) / 8;
  const lenScore = lenNorm * 10;

  // 5. חוק עברי (משקל 15)
  const ruleHit = matchesHebrewRule(input.wrong, input.correct);
  const ruleScore = ruleHit ? 15 : 0;

  // 6. מילון/תיקונים נלמדים (משקל 15)
  const vocabScore = input.inVocabulary ? 15 : 0;

  // 7. AI review bonus (עד +10, לא חלק מ-100 הבסיס — נוסף ב-clamp)
  const aiScore = input.aiConfidence != null
    ? Math.max(0, Math.min(10, input.aiConfidence * 10))
    : 0;

  const base = levenshteinScore + phonScore + occScore + lenScore + ruleScore + vocabScore;
  const total = Math.round(Math.max(0, Math.min(100, base + aiScore)));

  return {
    total,
    parts: {
      levenshtein: Math.round(levenshteinScore),
      phonetic: Math.round(phonScore),
      occurrences: Math.round(occScore),
      wordLength: Math.round(lenScore),
      ruleEngine: ruleScore,
      vocabulary: vocabScore,
      aiReview: Math.round(aiScore),
    },
    ruleHit,
  };
}

export function confidenceColor(score: number): { bg: string; text: string; label: string } {
  if (score >= 80) return { bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300', label: 'גבוה' };
  if (score >= 50) return { bg: 'bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300', label: 'בינוני' };
  return { bg: 'bg-rose-500/15', text: 'text-rose-700 dark:text-rose-300', label: 'נמוך' };
}
