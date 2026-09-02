import type { TextReplacementOccurrence } from './hebrewTextReplacement';
import { createTraceOperation, type TranscriptionTraceOperation } from './transcriptionTrace';

export const MEDIAL_TO_FINAL: Readonly<Record<string, string>> = {
  כ: 'ך', מ: 'ם', נ: 'ן', פ: 'ף', צ: 'ץ',
};

export const FINAL_TO_MEDIAL: Readonly<Record<string, string>> = {
  ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ',
};

// Maqaf and punctuation delimit word parts. Niqqud and cantillation remain
// attached to their base letter while final-form decisions use letter indexes.
const HEBREW_WORD_PATTERN = /[\u05D0-\u05EA\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7'"׳״]+/g;

export interface HebrewFinalLettersResult {
  text: string;
  appliedCount: number;
  applied: Array<{ from: string; to: string; count: number }>;
  traceOperations: TranscriptionTraceOperation[];
}

/** The sole mutating implementation of mandatory Hebrew final-letter forms. */
export function normalizeHebrewFinalLettersDetailed(text: string): HebrewFinalLettersResult {
  const misplacedOccurrences: TextReplacementOccurrence[] = [];
  const misplacedText = text.replace(HEBREW_WORD_PATTERN, (token, offset: number) => {
    const chars = Array.from(token);
    const letterIndexes = chars
      .map((char, index) => (/^[\u05D0-\u05EA]$/.test(char) ? index : -1))
      .filter(index => index >= 0);
    if (letterIndexes.length === 0) return token;

    for (const index of letterIndexes.slice(0, -1)) {
      const before = chars[index];
      const after = FINAL_TO_MEDIAL[before] || before;
      if (before === after) continue;
      chars[index] = after;
      misplacedOccurrences.push({
        inputStart: offset + index,
        inputEnd: offset + index + before.length,
        outputStart: offset + index,
        outputEnd: offset + index + after.length,
        before,
        after,
      });
    }

    return chars.join('');
  });

  const requiredOccurrences: TextReplacementOccurrence[] = [];
  const normalized = misplacedText.replace(HEBREW_WORD_PATTERN, (token, offset: number, sourceText: string) => {
    const chars = Array.from(token);
    const letterIndexes = chars
      .map((char, index) => (/^[\u05D0-\u05EA]$/.test(char) ? index : -1))
      .filter(index => index >= 0);
    if (letterIndexes.length === 0) return token;

    const lastIndex = letterIndexes[letterIndexes.length - 1];
    const nextChar = sourceText[offset + token.length] || '';
    const trailingMarks = chars.slice(lastIndex + 1).join('');
    const leadingLetters = letterIndexes.slice(0, -1).map(index => chars[index]);
    const isSingleLetterAbbreviation = /['׳]/.test(`${trailingMarks}${nextChar}`)
      && leadingLetters.length <= 2
      && leadingLetters.every(char => /^[והבלמשכ]$/.test(char));
    if (!isSingleLetterAbbreviation) {
      const before = chars[lastIndex];
      const after = MEDIAL_TO_FINAL[before] || before;
      if (before !== after) {
        chars[lastIndex] = after;
        requiredOccurrences.push({
          inputStart: offset + lastIndex,
          inputEnd: offset + lastIndex + before.length,
          outputStart: offset + lastIndex,
          outputEnd: offset + lastIndex + after.length,
          before,
          after,
        });
      }
    }
    return chars.join('');
  });

  const changes = new Map<string, { from: string; to: string; count: number }>();
  let originalMatch: RegExpExecArray | null;
  const originalPattern = new RegExp(HEBREW_WORD_PATTERN.source, HEBREW_WORD_PATTERN.flags);
  while ((originalMatch = originalPattern.exec(text)) !== null) {
    const from = originalMatch[0];
    const to = normalized.slice(originalMatch.index, originalMatch.index + from.length);
    if (from === to) continue;
    const key = `${from}\u0000${to}`;
    const existing = changes.get(key);
    if (existing) existing.count += 1;
    else changes.set(key, { from, to, count: 1 });
  }

  const traceOperations: TranscriptionTraceOperation[] = [];
  if (misplacedOccurrences.length > 0) {
    traceOperations.push(createTraceOperation({
      sequence: traceOperations.length,
      ruleId: 'final-letter-misplaced',
      source: {
        system: 'mandatory-hebrew-orthography',
        file: 'src/lib/hebrewOrthography.ts',
        function: 'normalizeHebrewFinalLettersDetailed',
        store: 'hardcoded:FINAL_TO_MEDIAL',
      },
      beforeText: text,
      afterText: misplacedText,
      occurrences: misplacedOccurrences,
    }));
  }
  if (requiredOccurrences.length > 0) {
    traceOperations.push(createTraceOperation({
      sequence: traceOperations.length,
      ruleId: 'final-letter-required',
      source: {
        system: 'mandatory-hebrew-orthography',
        file: 'src/lib/hebrewOrthography.ts',
        function: 'normalizeHebrewFinalLettersDetailed',
        store: 'hardcoded:MEDIAL_TO_FINAL',
      },
      beforeText: misplacedText,
      afterText: normalized,
      occurrences: requiredOccurrences,
    }));
  }

  const applied = Array.from(changes.values());
  return {
    text: normalized,
    appliedCount: applied.reduce((sum, change) => sum + change.count, 0),
    applied,
    traceOperations,
  };
}
