import { describe, expect, it } from 'vitest';
import {
  buildTranslateGemmaPrompt,
  buildTranslationPrompt,
  characterNgramFScore,
  extractTextFromImportedFile,
  splitTranslationText,
  TRANSLATION_LANGUAGES,
} from './translation';

describe('translation helpers', () => {
  it('keeps every paragraph when splitting long text', () => {
    const text = ['א'.repeat(40), 'ב'.repeat(40), 'ג'.repeat(40)].join('\n\n');
    const chunks = splitTranslationText(text, 55);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n\n').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
  });

  it('builds an explicit translation-only prompt with glossary', () => {
    const prompt = buildTranslationPrompt({
      sourceCode: 'he',
      targetCode: 'yi',
      preserveStructure: true,
      glossary: 'בבא בתרא = Bava Batra',
    });
    expect(prompt).toContain('יידיש');
    expect(prompt).toContain('Bava Batra');
    expect(prompt).toContain('Return only the translated text');
  });

  it('imports text from common transcript JSON shapes', () => {
    expect(extractTextFromImportedFile(JSON.stringify({ edited_text: 'מתוקן', text: 'מקור' }), 'a.json')).toBe('מתוקן');
    expect(extractTextFromImportedFile(JSON.stringify({ segments: [{ text: 'א' }, { text: 'ב' }] }), 'a.json')).toBe('א\nב');
  });

  it('offers exactly the six requested languages', () => {
    expect(TRANSLATION_LANGUAGES.map(language => language.code)).toEqual(['he', 'en', 'de', 'fr', 'es', 'yi']);
  });

  it('uses the TranslateGemma prompt contract and rejects automatic source detection', () => {
    const prompt = buildTranslateGemmaPrompt({
      sourceCode: 'he',
      targetCode: 'de',
      preserveStructure: true,
    });
    expect(prompt).toContain('Hebrew (he) to German (de)');
    expect(prompt).toContain('Please translate the following Hebrew text into German:');
    expect(() => buildTranslateGemmaPrompt({
      sourceCode: 'auto',
      targetCode: 'en',
      preserveStructure: true,
    })).toThrow('בחירה ידנית');
  });

  it('scores identical reference text objectively', () => {
    expect(characterNgramFScore('Bonjour. Merci beaucoup.', 'Bonjour. Merci beaucoup.')).toBe(100);
    expect(characterNgramFScore('Bonjour.', 'Guten Morgen.')).toBeLessThan(20);
  });
});
