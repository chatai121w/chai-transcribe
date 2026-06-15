/**
 * Auto Summary Generator
 * 
 * Generates quick, local summaries of transcriptions without
 * requiring an external AI service. Uses statistical NLP techniques.
 */

export interface TranscriptSummaryData {
  wordCount: number;
  charCount: number;
  sentenceCount: number;
  paragraphCount: number;
  estimatedDurationMin: number;
  topWords: Array<{ word: string; count: number }>;
  language: 'hebrew' | 'english' | 'mixed';
  hebrewRatio: number;
  readingTimeMin: number;
  keyPhrases: string[];
}

// Hebrew stop words to exclude from keyword analysis
const HEBREW_STOP_WORDS = new Set([
  'של', 'את', 'על', 'עם', 'זה', 'הוא', 'היא', 'הם', 'הן', 'אני', 'אתה', 'את',
  'אנחנו', 'שלי', 'שלך', 'שלו', 'שלה', 'שלנו', 'שלהם', 'כל', 'גם', 'אם', 'או',
  'כי', 'אבל', 'רק', 'לא', 'כן', 'יש', 'אין', 'היה', 'היתה', 'היו', 'יהיה',
  'יכול', 'צריך', 'רוצה', 'אומר', 'אומרת', 'מה', 'איך', 'למה', 'מתי', 'איפה',
  'מי', 'כמה', 'בין', 'אחרי', 'לפני', 'עכשיו', 'אחר', 'כך', 'פה', 'שם', 'כבר',
  'עוד', 'מאוד', 'ממש', 'ביותר', 'לכן', 'אלא', 'כמו', 'בו', 'בה', 'בהם', 'להם',
  'לו', 'לה', 'לנו', 'אותו', 'אותה', 'אותם', 'אותן', 'אחד', 'אחת', 'שני', 'שתי',
  'כדי', 'בגלל', 'לפי', 'דרך', 'עד', 'מן', 'תוך', 'בלי', 'הזה', 'הזאת', 'האלה',
  'אלה', 'אלו', 'היינו', 'הייתי', 'הייתם', 'הנה', 'באמת', 'בסדר', 'נכון', 'טוב',
]);

const ENGLISH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'shall', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'our', 'their', 'not', 'no', 'so', 'if', 'as', 'just',
  'about', 'up', 'out', 'then', 'than', 'very', 'also', 'more', 'some', 'any',
]);

/**
 * Generate a statistical summary of transcription text.
 */
export function generateSummary(text: string): TranscriptSummaryData {
  if (!text || !text.trim()) {
    return {
      wordCount: 0, charCount: 0, sentenceCount: 0, paragraphCount: 0,
      estimatedDurationMin: 0, topWords: [], language: 'hebrew',
      hebrewRatio: 0, readingTimeMin: 0, keyPhrases: [],
    };
  }

  const cleanText = text.trim();
  const charCount = cleanText.length;
  const words = cleanText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentences = cleanText.split(/[.!?。]+/).filter(s => s.trim().length > 0);
  const sentenceCount = sentences.length;
  const paragraphs = cleanText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const paragraphCount = Math.max(1, paragraphs.length);

  // Language detection
  const hebrewChars = (cleanText.match(/[\u0590-\u05FF]/g) || []).length;
  const latinChars = (cleanText.match(/[a-zA-Z]/g) || []).length;
  const totalLetters = hebrewChars + latinChars;
  const hebrewRatio = totalLetters > 0 ? hebrewChars / totalLetters : 0;
  const language = hebrewRatio > 0.7 ? 'hebrew' : hebrewRatio < 0.3 ? 'english' : 'mixed';

  // Speech rate: ~150 words/min Hebrew, ~160 words/min English
  const wordsPerMin = language === 'hebrew' ? 150 : 160;
  const estimatedDurationMin = Math.round((wordCount / wordsPerMin) * 10) / 10;

  // Reading time: ~200 words/min
  const readingTimeMin = Math.round((wordCount / 200) * 10) / 10;

  // Word frequency analysis (excluding stop words)
  const stopWords = language === 'english' ? ENGLISH_STOP_WORDS : HEBREW_STOP_WORDS;
  const wordFreq = new Map<string, number>();

  for (const raw of words) {
    const cleaned = raw.replace(/[.,;:!?"""''׳״\-–—()\[\]{}0-9]/g, '').trim();
    if (cleaned.length < 2 || stopWords.has(cleaned)) continue;
    wordFreq.set(cleaned, (wordFreq.get(cleaned) || 0) + 1);
  }

  const topWords = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));

  // Extract key phrases (bigrams that appear multiple times)
  const phraseFreq = new Map<string, number>();
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i].replace(/[.,;:!?"""''׳״\-–—()\[\]{}]/g, '').trim();
    const w2 = words[i + 1].replace(/[.,;:!?"""''׳״\-–—()\[\]{}]/g, '').trim();
    if (w1.length < 2 || w2.length < 2) continue;
    if (stopWords.has(w1) && stopWords.has(w2)) continue;
    const phrase = `${w1} ${w2}`;
    phraseFreq.set(phrase, (phraseFreq.get(phrase) || 0) + 1);
  }

  const keyPhrases = [...phraseFreq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([phrase]) => phrase);

  return {
    wordCount, charCount, sentenceCount, paragraphCount,
    estimatedDurationMin, topWords, language, hebrewRatio,
    readingTimeMin, keyPhrases,
  };
}
