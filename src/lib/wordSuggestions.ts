const INVISIBLE_FORMAT_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const EDGE_PUNCTUATION = /^[\s.,;:!?"'׳״()[\]{}<>\-–—]+|[\s.,;:!?"'׳״()[\]{}<>\-–—]+$/g;

/** Canonical key for comparing suggestions that render as the same word. */
export function suggestionKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(INVISIBLE_FORMAT_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Preserve source order while removing empty, duplicate and no-op suggestions. */
export function uniqueWordSuggestions(suggestions: string[], originalWord: string): string[] {
  const originalKey = suggestionKey(originalWord).replace(EDGE_PUNCTUATION, '');
  const seen = new Set<string>();
  const result: string[] = [];

  for (const suggestion of suggestions) {
    const display = suggestionKey(suggestion);
    const key = display.replace(EDGE_PUNCTUATION, '');
    if (!key || key === originalKey || seen.has(key)) continue;
    seen.add(key);
    result.push(display);
  }
  return result;
}
