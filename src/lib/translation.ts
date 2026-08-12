export type TranslationLanguage = {
  code: string;
  label: string;
  modelLabel: string;
  direction: 'rtl' | 'ltr';
};

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'he', label: 'עברית', modelLabel: 'Hebrew', direction: 'rtl' },
  { code: 'en', label: 'אנגלית', modelLabel: 'English', direction: 'ltr' },
  { code: 'de', label: 'גרמנית', modelLabel: 'German', direction: 'ltr' },
  { code: 'fr', label: 'צרפתית', modelLabel: 'French', direction: 'ltr' },
  { code: 'es', label: 'ספרדית', modelLabel: 'Spanish', direction: 'ltr' },
  { code: 'yi', label: 'יידיש', modelLabel: 'Yiddish', direction: 'rtl' },
];

export const TRANSLATEGEMMA_MODEL = 'translategemma:4b';

export function isTranslateGemmaModel(modelName: string): boolean {
  return modelName === 'translategemma' || modelName.startsWith('translategemma:');
}

export function getTranslationLanguage(code: string): TranslationLanguage {
  return TRANSLATION_LANGUAGES.find(language => language.code === code)
    || TRANSLATION_LANGUAGES[1];
}

export function buildTranslationPrompt(args: {
  sourceCode: string;
  targetCode: string;
  preserveStructure: boolean;
  glossary?: string;
}): string {
  const source = args.sourceCode === 'auto'
    ? 'Detect the source language automatically.'
    : `The source language is ${getTranslationLanguage(args.sourceCode).label} (${args.sourceCode}).`;
  const target = getTranslationLanguage(args.targetCode);
  const structure = args.preserveStructure
    ? 'Preserve paragraph breaks, speaker labels, timestamps, numbering, and punctuation structure.'
    : 'Use natural paragraphing in the target language.';
  const glossary = args.glossary?.trim()
    ? `Apply this glossary exactly when relevant:\n${args.glossary.trim()}`
    : '';

  return [
    'TRANSLATION TASK. You are a precise professional translator.',
    source,
    `TARGET LANGUAGE: ${target.modelLabel} (${target.code}).`,
    `Translate the entire source text into ${target.modelLabel}. Every normal sentence in the answer must be written in ${target.modelLabel}.`,
    structure,
    'Preserve names, citations, religious terminology, and meaning. Do not summarize, omit, explain, or add content.',
    glossary,
    'Return only the translated text.',
  ].filter(Boolean).join('\n');
}

export function buildStrictTranslationRetryPrompt(args: {
  sourceCode: string;
  targetCode: string;
  preserveStructure: boolean;
  glossary?: string;
}): string {
  const target = getTranslationLanguage(args.targetCode);
  return [
    buildTranslationPrompt(args),
    '',
    'THE PREVIOUS RESPONSE USED THE WRONG LANGUAGE OR EXPLAINED THE SOURCE.',
    `Rewrite it now using ${target.modelLabel} (${target.code}) only.`,
    'Do not discuss the text. Do not describe the translation. Do not repeat the source language except for proper names that cannot be translated.',
  ].join('\n');
}

/** Detect a clear script mismatch without rejecting occasional names or citations. */
export function isLikelyWrongTranslationLanguage(output: string, targetCode: string): boolean {
  const hebrewLetters = (output.match(/[\u0590-\u05FF]/g) || []).length;
  const latinLetters = (output.match(/[A-Za-zÀ-ÖØ-öø-ÿ]/g) || []).length;
  const scriptLetters = hebrewLetters + latinLetters;
  if (scriptLetters < 20) return false;
  const targetUsesHebrewScript = targetCode === 'he' || targetCode === 'yi';
  return targetUsesHebrewScript
    ? latinLetters / scriptLetters > 0.65
    : hebrewLetters / scriptLetters > 0.55;
}

/** TranslateGemma requires explicit ISO language codes and two blank lines before the source text. */
export function buildTranslateGemmaPrompt(args: {
  sourceCode: string;
  targetCode: string;
  preserveStructure: boolean;
  glossary?: string;
}): string {
  if (args.sourceCode === 'auto') {
    throw new Error('TranslateGemma דורש בחירה ידנית של שפת המקור');
  }
  const source = getTranslationLanguage(args.sourceCode);
  const target = getTranslationLanguage(args.targetCode);
  const requirements = [
    args.preserveStructure
      ? 'Preserve paragraph breaks, speaker labels, timestamps, numbering, and punctuation structure.'
      : '',
    args.glossary?.trim() ? `Apply this glossary exactly when relevant:\n${args.glossary.trim()}` : '',
    'Preserve proper names, citations, religious terminology, and every piece of meaning. Do not summarize or omit content.',
  ].filter(Boolean).join('\n');

  return [
    `You are a professional ${source.modelLabel} (${source.code}) to ${target.modelLabel} (${target.code}) translator. Your goal is to accurately convey the meaning and nuances of the original ${source.modelLabel} text while adhering to ${target.modelLabel} grammar, vocabulary, and cultural sensitivities.`,
    `Produce only the ${target.modelLabel} translation, without any additional explanations or commentary.`,
    requirements,
    `Please translate the following ${source.modelLabel} text into ${target.modelLabel}:`,
  ].filter(Boolean).join('\n');
}

/** Split long transcripts on paragraph boundaries while never dropping text. */
export function splitTranslationText(text: string, maxChars = 9000): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const blocks = normalized.split(/(\n{2,})/);
  const chunks: string[] = [];
  let current = '';

  const flush = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = '';
  };

  for (const block of blocks) {
    if (!block) continue;
    if (block.length > maxChars) {
      flush();
      for (let offset = 0; offset < block.length; offset += maxChars) {
        const value = block.slice(offset, offset + maxChars).trim();
        if (value) chunks.push(value);
      }
      continue;
    }
    if (current && current.length + block.length > maxChars) flush();
    current += block;
  }
  flush();
  return chunks;
}

/** Character n-gram F-score (chrF-style) for an objective, language-independent reference check. */
export function characterNgramFScore(reference: string, candidate: string, n = 3): number {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const grams = (value: string) => {
    const normalized = normalize(value);
    const counts = new Map<string, number>();
    if (normalized.length < n) {
      if (normalized) counts.set(normalized, 1);
      return counts;
    }
    for (let index = 0; index <= normalized.length - n; index += 1) {
      const gram = normalized.slice(index, index + n);
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
    return counts;
  };
  const expected = grams(reference);
  const actual = grams(candidate);
  const expectedTotal = [...expected.values()].reduce((sum, count) => sum + count, 0);
  const actualTotal = [...actual.values()].reduce((sum, count) => sum + count, 0);
  if (!expectedTotal || !actualTotal) return reference.trim() === candidate.trim() ? 100 : 0;
  let overlap = 0;
  expected.forEach((count, gram) => { overlap += Math.min(count, actual.get(gram) || 0); });
  const precision = overlap / actualTotal;
  const recall = overlap / expectedTotal;
  return precision + recall ? Math.round((2 * precision * recall / (precision + recall)) * 1000) / 10 : 0;
}

export const LOCAL_TRANSLATION_SMOKE_CASES = [
  { sourceCode: 'en', targetCode: 'he', source: 'Good morning. Thank you very much.', reference: 'בוקר טוב. תודה רבה.' },
  { sourceCode: 'en', targetCode: 'de', source: 'Good morning. Thank you very much.', reference: 'Guten Morgen. Vielen Dank.' },
  { sourceCode: 'en', targetCode: 'fr', source: 'Good morning. Thank you very much.', reference: 'Bonjour. Merci beaucoup.' },
  { sourceCode: 'en', targetCode: 'es', source: 'Good morning. Thank you very much.', reference: 'Buenos días. Muchas gracias.' },
  { sourceCode: 'en', targetCode: 'yi', source: 'Good morning. Thank you very much.', reference: 'אַ גוטן מאָרגן. אַ גרויסן דאַנק.' },
  { sourceCode: 'he', targetCode: 'en', source: 'בוקר טוב. תודה רבה.', reference: 'Good morning. Thank you very much.' },
] as const;

export function extractTextFromImportedFile(contents: string, fileName: string): string {
  if (!fileName.toLowerCase().endsWith('.json')) return contents;
  try {
    const parsed = JSON.parse(contents) as unknown;
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      for (const key of ['edited_text', 'text', 'transcript', 'content']) {
        if (typeof record[key] === 'string') return record[key] as string;
      }
      if (Array.isArray(record.segments)) {
        return record.segments
          .map(segment => segment && typeof segment === 'object' ? (segment as Record<string, unknown>).text : '')
          .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
          .join('\n');
      }
    }
  } catch {
    return contents;
  }
  return contents;
}
