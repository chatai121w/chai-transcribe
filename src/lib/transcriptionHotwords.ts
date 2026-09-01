import { buildLoshonKodeshHotwords } from '@/lib/loshonKodesh';
import { isPersonalPronunciationEnabled } from '@/lib/personalPronunciationModel';
import { buildProfileHotwords } from '@/lib/pronunciationProfiles';
import { getLearnedHotwords } from '@/utils/correctionLearning';
import {
  getRankedVocabularyTerms,
  isCustomVocabularyEnabled,
  normalizeVocabularyKey,
} from '@/utils/customVocabulary';

interface HotwordCandidate {
  value: string;
  score: number;
  order: number;
}

function splitTerms(value: string): string[] {
  return value.split(/[,，\n]/).map((term) => term.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

/** Build a bounded, deduplicated bias list instead of sending the full history. */
export function buildTranscriptionHotwords(options: {
  manual?: string;
  context?: string;
  loshonKodesh?: boolean;
  limit?: number;
} = {}): string | undefined {
  const scores = new Map<string, HotwordCandidate>();
  const context = (options.context || '').toLocaleLowerCase('he');
  let order = 0;

  const add = (value: string, baseScore: number) => {
    for (const term of splitTerms(value)) {
      const key = normalizeVocabularyKey(term);
      const contextBoost = context.includes(key) ? 500 : 0;
      const score = baseScore + contextBoost;
      const existing = scores.get(key);
      if (!existing || score > existing.score) scores.set(key, { value: term, score, order: order++ });
    }
  };

  add(options.manual || '', 1000);
  if (isCustomVocabularyEnabled()) {
    for (const entry of getRankedVocabularyTerms(options.context, options.limit ?? 60)) {
      const key = normalizeVocabularyKey(entry.term);
      const isPersonal = entry.source === 'user' || entry.source === 'approved-correction' || entry.source === 'import';
      const matchesContext = key.length >= 2 && normalizeVocabularyKey(options.context || '').includes(key);
      if (!isPersonal && !matchesContext) continue;
      add(entry.term, (matchesContext ? 600 : 500) + Math.min(100, entry.usageCount || 0));
    }
  }
  if (isPersonalPronunciationEnabled()) add(getLearnedHotwords(120), 450);
  add(buildProfileHotwords(), 550);
  if (options.loshonKodesh) add(buildLoshonKodeshHotwords(), 100);

  const selected = Array.from(scores.values())
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, options.limit ?? 60)
    .map((candidate) => candidate.value);
  return selected.length ? selected.join(', ') : undefined;
}
