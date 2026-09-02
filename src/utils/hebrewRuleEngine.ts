import type { TextReplacementOccurrence } from '@/lib/hebrewTextReplacement';
import { createTraceOperation, type TranscriptionTraceOperation } from '@/lib/transcriptionTrace';
import {
  FINAL_TO_MEDIAL as NORMAL_MAP,
  MEDIAL_TO_FINAL as FINAL_MAP,
  normalizeHebrewFinalLettersDetailed,
} from '@/lib/hebrewOrthography';

/**
 * Hebrew Rule Engine — דטרמיניסטי, ללא AI
 *
 * אוסף חוקים לתיקון שגיאות נפוצות בעברית שיוצאות ממנועי ASR (Whisper וכו').
 * החוקים פועלים על ההיפותזה לפני ה-diff מול הטקסט הקנוני, כדי לסלק
 * רעש "טכני" (סופיות, רווחים כפולים) ולתת ביטחון גבוה לתיקונים בטוחים.
 *
 * מקורות השראה:
 * - github.com/ivrit-ai/whisper        — דפוסי טעויות עבריות
 * - github.com/Dicta-Israel-Center     — נורמליזציה
 * - github.com/eyaler/hspell           — חוקי סופיות
 */

export interface RuleHit {
  from: string;       // המילה הלא-נכונה
  to: string;         // המילה המתוקנת
  ruleId: string;     // מזהה החוק שהפעיל
  confidence: number; // 0-100
  reason: string;     // הסבר קצר בעברית
  occurrence?: TextReplacementOccurrence;
}

const DEFINITIVE_RULES_KEY = 'definitive_hebrew_rules_enabled';

export function areDefinitiveRulesEnabled(): boolean {
  try { return localStorage.getItem(DEFINITIVE_RULES_KEY) !== '0'; } catch { return true; }
}

export function setDefinitiveRulesEnabled(enabled: boolean): void {
  localStorage.setItem(DEFINITIVE_RULES_KEY, enabled ? '1' : '0');
}

export const DEFINITIVE_RULES = [
  { id: 'final-letter-required', title: 'אות סופית בסוף מילה', description: 'כ, מ, נ, פ, צ בסוף מילה הופכות ל-ך, ם, ן, ף, ץ', examples: ['חוקיכ → חוקיך', 'מצוותיכ → מצוותיך'] },
  { id: 'final-letter-misplaced', title: 'אות סופית רק בסוף מילה', description: 'ך, ם, ן, ף, ץ באמצע מילה חוזרות לצורה הרגילה', examples: ['ךתב → כתב', 'םילה → מילה'] },
  { id: 'normalize-spacing', title: 'רווחים ופיסוק', description: 'מסיר רווחים כפולים ורווח מיותר לפני סימן פיסוק', examples: ['שלום  עולם → שלום עולם'] },
] as const;

// סטריפ ניקוד/טעמים לבדיקת אותיות בלבד
const stripNikud = (s: string): string => s.replace(/[\u0591-\u05C7]/g, '');
const normalizeSpaces = (s: string): string => stripNikud(s).trim().replace(/\s+/g, ' ');
const isHebrewLetter = (ch: string): boolean => /^[\u05D0-\u05EA]$/.test(ch);

const toRegularFinalSkeleton = (s: string): string =>
  normalizeSpaces(s).replace(/[ךםןףץ]/g, (ch) => NORMAL_MAP[ch] ?? ch);

const countFinalOnlyDifferences = (wrong: string, correct: string): number => {
  const a = normalizeSpaces(wrong);
  const b = normalizeSpaces(correct);
  if (a.length !== b.length) return 0;
  let diffs = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (FINAL_MAP[a[i]] === b[i] || NORMAL_MAP[a[i]] === b[i]) {
      diffs += 1;
      continue;
    }
    return 0;
  }
  return diffs;
};

/**
 * חוק #1: אות סופית חייבת בסוף מילה.
 *   "אומרים" עם 'מ' בסוף → 'ם'.
 *   "מלכ" → "מלך".
 */
export function ruleFinalLetterRequired(word: string): RuleHit | null {
  if (stripNikud(word).length < 2) return null;
  const normalized = normalizeHebrewFinalLettersDetailed(word);
  const operation = normalized.traceOperations.find(item => item.ruleId === 'final-letter-required');
  if (!operation) return null;
  return {
    from: word,
    to: normalized.text,
    ruleId: 'final-letter-required',
    confidence: 100,
    reason: 'אות רגילה בסוף מילה הומרה לצורה הסופית המחייבת',
    occurrence: operation.occurrences[0],
  };
}

/**
 * חוק #2: אות סופית באמצע מילה היא טעות.
 *   "ךתב" → "כתב", "םילה" → "מילה".
 */
export function ruleFinalLetterMisplaced(word: string): RuleHit | null {
  if (stripNikud(word).length < 2) return null;
  const normalized = normalizeHebrewFinalLettersDetailed(word);
  const operation = normalized.traceOperations.find(item => item.ruleId === 'final-letter-misplaced');
  if (!operation) return null;
  return {
    from: word,
    to: normalized.text,
    ruleId: 'final-letter-misplaced',
    confidence: 100,
    reason: 'אות סופית הופיעה באמצע מילה',
    occurrence: operation.occurrences[0],
  };
}

/**
 * חוק #3: רווחים כפולים ופיסוק.
 *   רץ על המשפט כולו, לא על מילה.
 */
export function ruleNormalizeSpacing(text: string): {
  text: string;
  changed: boolean;
  traceOperations: TranscriptionTraceOperation[];
} {
  let next = text;
  const traceOperations: TranscriptionTraceOperation[] = [];
  const source = {
    system: 'definitive-hebrew-rules',
    file: 'src/utils/hebrewRuleEngine.ts',
    function: 'ruleNormalizeSpacing',
    store: 'hardcoded:DEFINITIVE_RULES',
  };

  const replaceExact = (
    ruleId: string,
    expression: RegExp,
    replacementFor: (match: string, captures: string[]) => { text: string; startWithinMatch: number; before: string; after: string },
  ) => {
    const beforeText = next;
    const occurrences: TextReplacementOccurrence[] = [];
    let outputDelta = 0;
    next = next.replace(expression, (match: string, ...args: unknown[]) => {
      const matchOffset = args[args.length - 2] as number;
      const captures = args.slice(0, -2) as string[];
      const replacement = replacementFor(match, captures);
      const inputStart = matchOffset + replacement.startWithinMatch;
      const outputStart = inputStart + outputDelta;
      occurrences.push({
        inputStart,
        inputEnd: inputStart + replacement.before.length,
        outputStart,
        outputEnd: outputStart + replacement.after.length,
        before: replacement.before,
        after: replacement.after,
        ruleId,
      });
      outputDelta += replacement.text.length - match.length;
      return replacement.text;
    });
    if (occurrences.length > 0) {
      traceOperations.push(createTraceOperation({
        sequence: traceOperations.length,
        ruleId,
        source,
        beforeText,
        afterText: next,
        occurrences,
      }));
    }
  };

  replaceExact('normalize-spacing:collapse-horizontal', /[ \t]{2,}/g, (match) => ({
    text: ' ', startWithinMatch: 0, before: match, after: ' ',
  }));
  replaceExact('normalize-spacing:before-punctuation', /(\s+)([,.!?;:׃])/g, (_match, [spaces, punctuation]) => ({
    text: punctuation, startWithinMatch: 0, before: spaces, after: '',
  }));
  replaceExact('normalize-spacing:after-opening', /([(\[])(\s+)/g, (_match, [opening, spaces]) => ({
    text: opening, startWithinMatch: opening.length, before: spaces, after: '',
  }));
  replaceExact('normalize-spacing:before-closing', /(\s+)([)\]])/g, (_match, [spaces, closing]) => ({
    text: closing, startWithinMatch: 0, before: spaces, after: '',
  }));

  return { text: next, changed: next !== text, traceOperations };
}

/**
 * חוק #4: "ו" כפולה בתחילת מילה בעברית רגילה היא לרוב טעות.
 *   "ווידוי" → "וידוי" (רק כשמילה ארוכה מ-3 ויש לפחות 2 תנועות אחר כך).
 *   זהיר! יש שמות פרטיים עם וו כפולה ("שלמה ווייס"), אז ביטחון נמוך.
 */
export function ruleDoubleVavStart(word: string): RuleHit | null {
  const stripped = stripNikud(word);
  if (stripped.length < 4) return null;
  if (stripped.startsWith('וו') && !stripped.startsWith('ווא')) {
    const corrected = word.replace(/^וו/, 'ו');
    return {
      from: word,
      to: corrected,
      ruleId: 'double-vav-start',
      confidence: 55,
      reason: 'וו כפולה בתחילת מילה — לרוב צריך וו אחת',
    };
  }
  return null;
}

const CORRECTION_DICT: Array<{ from: RegExp; to: string; ruleId: string; reason: string; confidence: number }> = [
  { from: /^ארהב$/, to: 'ארה״ב', ruleId: 'abbrev-usa', reason: 'ראשי תיבות', confidence: 90 },
  { from: /^צהל$/, to: 'צה״ל', ruleId: 'abbrev-idf', reason: 'ראשי תיבות', confidence: 90 },
  { from: /^בעהמ$/, to: 'בע״מ', ruleId: 'abbrev-ltd', reason: 'ראשי תיבות', confidence: 90 },
  { from: /^וכו$/, to: 'וכו׳', ruleId: 'abbrev-etc', reason: 'קיצור', confidence: 85 },
];

export function ruleAbbreviations(word: string): RuleHit | null {
  const stripped = stripNikud(word);
  for (const rule of CORRECTION_DICT) {
    if (rule.from.test(stripped)) {
      return {
        from: word,
        to: rule.to,
        ruleId: rule.ruleId,
        confidence: rule.confidence,
        reason: rule.reason,
      };
    }
  }
  return null;
}

/**
 * מריץ את כל החוקים על מילה אחת ומחזיר את התיקון הראשון שנמצא.
 */
export function applyRulesToWord(word: string): RuleHit | null {
  if (!word || word.length < 2) return null;
  // בודק שלא רק סימני פיסוק
  if (!/[\u05D0-\u05EA]/.test(word)) return null;

  return (
    ruleFinalLetterMisplaced(word) ??
    ruleFinalLetterRequired(word) ??
    ruleAbbreviations(word) ??
    ruleDoubleVavStart(word)
  );
}

/**
 * מריץ את כל החוקים על טקסט שלם ומחזיר רשימת תיקונים + טקסט מתוקן.
 */
export function applyRulesToText(text: string): { fixedText: string; hits: RuleHit[] } {
  const { text: spaced } = ruleNormalizeSpacing(text);
  const tokens = spaced.split(/(\s+)/); // שומר רווחים
  const hits: RuleHit[] = [];
  const out: string[] = [];
  for (const tok of tokens) {
    if (/^\s+$/.test(tok) || !tok) {
      out.push(tok);
      continue;
    }
    // הסר סימני פיסוק בקצוות לפני בדיקה
    const m = tok.match(/^(\p{P}*)(.*?)(\p{P}*)$/u);
    if (!m) {
      out.push(tok);
      continue;
    }
    const [, pre, core, post] = m;
    const hit = applyRulesToWord(core);
    if (hit) {
      hits.push(hit);
      out.push(pre + hit.to + post);
    } else {
      out.push(tok);
    }
  }
  return { fixedText: out.join(''), hits };
}

/** Applies only grammar rules that are safe enough to run unconditionally. */
export function applyDefinitiveRulesToText(text: string): {
  fixedText: string;
  hits: RuleHit[];
  traceOperations: TranscriptionTraceOperation[];
} {
  const spacing = ruleNormalizeSpacing(text);
  const orthography = normalizeHebrewFinalLettersDetailed(spacing.text);
  const hits: RuleHit[] = orthography.applied.flatMap(change =>
    Array.from({ length: change.count }, () => ({
      from: change.from,
      to: change.to,
      ruleId: 'mandatory-hebrew-orthography',
      confidence: 100,
      reason: 'צורת מנצפך תוקנה לפי מיקום האות במילה',
    })),
  );
  if (spacing.changed) {
    hits.push({ from: text, to: spacing.text, ruleId: 'normalize-spacing', confidence: 100, reason: 'רווחים ופיסוק תקניים' });
  }
  const traceOperations = [
    ...spacing.traceOperations,
    ...orthography.traceOperations.map((operation, index) => ({
      ...operation,
      sequence: spacing.traceOperations.length + index,
    })),
  ];
  return { fixedText: orthography.text, hits, traceOperations };
}

/**
 * האם זוג wrong→correct תואם לחוק עברי כלשהו?
 * משמש לחישוב ביטחון של תיקון שכבר נמצא ב-diff.
 */
export function matchesHebrewRule(wrong: string, correct: string): RuleHit | null {
  const wrongNorm = normalizeSpaces(wrong);
  const correctNorm = normalizeSpaces(correct);

  const hit = applyRulesToWord(wrongNorm);
  if (hit && normalizeSpaces(hit.to) === correctNorm) return hit;

  // זוגות שמגיעים מה-diff לפעמים כוללים רווח/פיסוק או כמה מילים.
  // אם השלד זהה אחרי המרת ך/ם/ן/ף/ץ לאות רגילה — זו בדיוק טעות אות סופית.
  const finalDiffs = countFinalOnlyDifferences(wrongNorm, correctNorm);
  if (finalDiffs > 0 && toRegularFinalSkeleton(wrongNorm) === toRegularFinalSkeleton(correctNorm)) {
    return {
      from: wrong,
      to: correct,
      ruleId: 'final-letter-pair-match',
      confidence: 98,
      reason: 'ההבדל היחיד הוא אות סופית בעברית',
    };
  }

  const fixed = applyRulesToText(wrongNorm);
  if (fixed.hits.length > 0 && normalizeSpaces(fixed.fixedText) === correctNorm) {
    return {
      ...fixed.hits[0],
      from: wrong,
      to: correct,
      confidence: Math.max(95, fixed.hits[0].confidence),
    };
  }
  return null;
}
