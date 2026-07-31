const WORD_CHAR_CLASS = '\\p{L}\\p{N}';
const HEBREW_PREFIX_CLASS = 'בוכלמשה';

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
): { text: string; count: number } {
  const pattern = escapePattern(original);
  if (!pattern || original.trim() === corrected.trim()) return { text, count: 0 };

  const expression = new RegExp(
    `(^|[^${WORD_CHAR_CLASS}])([${HEBREW_PREFIX_CLASS}]?)(${pattern})(?=$|[^${WORD_CHAR_CLASS}])`,
    'gu',
  );
  let count = 0;
  const next = text.replace(expression, (_match, boundary: string, hebrewPrefix: string) => {
    count += 1;
    return `${boundary}${hebrewPrefix}${corrected}`;
  });
  return { text: next, count };
}
