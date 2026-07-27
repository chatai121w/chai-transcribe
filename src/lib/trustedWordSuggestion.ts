import type { MenuSuggestion } from '@/utils/syncedSpellAssist';

export interface TrustedWordSuggestion extends MenuSuggestion {
  reason: string;
}

const SOURCE_RULES: Record<string, { minimum: number; reason: string }> = {
  dictionary: { minimum: 0.98, reason: 'מבוסס על תיקון ידני שאישרת' },
  learned: { minimum: 0.85, reason: 'מבוסס על למידה חוזרת מתיקונים קודמים' },
  'grammar-duplicate': { minimum: 1, reason: 'כלל חד-משמעי: מילה כפולה' },
};

/** Return a one-click fix only when one trusted answer exists without conflict. */
export function getTrustedWordSuggestion(suggestions: MenuSuggestion[]): TrustedWordSuggestion | null {
  const trusted = suggestions.filter((suggestion) => {
    const rule = SOURCE_RULES[suggestion.source];
    return Boolean(rule && suggestion.text && suggestion.text !== '__IGNORE__' && suggestion.score >= rule.minimum);
  });
  const uniqueTexts = [...new Set(trusted.map((suggestion) => suggestion.text.trim()).filter(Boolean))];
  if (uniqueTexts.length !== 1) return null;

  const winner = trusted.find((suggestion) => suggestion.text.trim() === uniqueTexts[0]);
  if (!winner) return null;
  const conflictingStrongSuggestion = suggestions.some((suggestion) =>
    suggestion.text.trim() !== uniqueTexts[0] && suggestion.score >= 0.85 && suggestion.text !== '__IGNORE__',
  );
  if (conflictingStrongSuggestion) return null;

  return { ...winner, reason: SOURCE_RULES[winner.source].reason };
}
