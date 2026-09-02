const WORD_CHAR_CLASS = '\\p{L}\\p{N}';
const HEBREW_PREFIX_CLASS = 'בוכלמשה';

export interface TextReplacementOccurrence {
  /** Offsets in the text immediately before this replacement rule ran. */
  inputStart: number;
  inputEnd: number;
  /** Offsets in the text immediately after this replacement rule ran. */
  outputStart: number;
  outputEnd: number;
  before: string;
  after: string;
  ruleId?: string;
  reason?: string;
}

export interface TextReplacementResult {
  text: string;
  count: number;
  occurrences: TextReplacementOccurrence[];
}

function escapePattern(value: string): string {
  return value
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
}

/** Replace complete Hebrew/Unicode words or phrases without touching substrings. */
export function replaceWholeTextOccurrences(
  text: string,
  original: string,
  corrected: string,
): TextReplacementResult {
  const pattern = escapePattern(original);
  if (!pattern || original.trim() === corrected.trim()) return { text, count: 0, occurrences: [] };

  const expression = new RegExp(
    `(^|[^${WORD_CHAR_CLASS}])([${HEBREW_PREFIX_CLASS}]?)(${pattern})(?=$|[^${WORD_CHAR_CLASS}])`,
    'gu',
  );
  let count = 0;
  let outputDelta = 0;
  const occurrences: TextReplacementOccurrence[] = [];
  const next = text.replace(expression, (
    _match,
    boundary: string,
    hebrewPrefix: string,
    matchedOriginal: string,
    matchOffset: number,
  ) => {
    const inputStart = matchOffset + boundary.length + hebrewPrefix.length;
    const outputStart = inputStart + outputDelta;
    occurrences.push({
      inputStart,
      inputEnd: inputStart + matchedOriginal.length,
      outputStart,
      outputEnd: outputStart + corrected.length,
      before: matchedOriginal,
      after: corrected,
    });
    outputDelta += corrected.length - matchedOriginal.length;
    count += 1;
    return `${boundary}${hebrewPrefix}${corrected}`;
  });
  return { text: next, count, occurrences };
}
