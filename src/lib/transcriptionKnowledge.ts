import { isLoshonKodeshEnabled, applyLoshonKodeshReplacements } from '@/lib/loshonKodesh';
import { isPersonalPronunciationEnabled } from '@/lib/personalPronunciationModel';
import { applyProfileCorrections, isProfileLoshonKodesh } from '@/lib/pronunciationProfiles';
import { applyLearnedCorrections } from '@/utils/correctionLearning';
import { applyVocabularyCorrections, isCustomVocabularyEnabled } from '@/utils/customVocabulary';
import { applyDefinitiveRulesToText, areDefinitiveRulesEnabled } from '@/utils/hebrewRuleEngine';

export interface TranscriptionKnowledgeResult {
  text: string;
  totalApplied: number;
  deterministicApplied: number;
  learnedApplied: Array<{ original: string; corrected: string }>;
  counts: {
    definitive: number;
    learned: number;
    profile: number;
    vocabulary: number;
    loshonKodesh: number;
  };
}

/** Canonical deterministic post-processing pipeline shared by every engine. */
export function applyTranscriptionKnowledge(text: string, engine: string): TranscriptionKnowledgeResult {
  const definitive = areDefinitiveRulesEnabled()
    ? applyDefinitiveRulesToText(text)
    : { fixedText: text, hits: [] };
  const personalEnabled = isPersonalPronunciationEnabled();
  const learned = personalEnabled
    ? applyLearnedCorrections(definitive.fixedText, { engine })
    : { text: definitive.fixedText, appliedCount: 0, applied: [] };
  const profile = personalEnabled
    ? applyProfileCorrections(learned.text)
    : { text: learned.text, appliedCount: 0 };
  const vocabulary = isCustomVocabularyEnabled()
    ? applyVocabularyCorrections(profile.text)
    : { text: profile.text, appliedCount: 0 };

  const lkActive = isLoshonKodeshEnabled() || isProfileLoshonKodesh();
  const lkText = lkActive ? applyLoshonKodeshReplacements(vocabulary.text) : vocabulary.text;
  const counts = {
    definitive: definitive.hits.length,
    learned: learned.appliedCount,
    profile: profile.appliedCount,
    vocabulary: vocabulary.appliedCount,
    loshonKodesh: lkText === vocabulary.text ? 0 : 1,
  };
  const deterministicApplied = counts.definitive + counts.learned + counts.profile + counts.vocabulary;

  return {
    text: lkText,
    totalApplied: deterministicApplied + counts.loshonKodesh,
    deterministicApplied,
    learnedApplied: learned.applied,
    counts,
  };
}
