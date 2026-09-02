import {
  applyLkAiFix,
  isLoshonKodeshEnabled,
  applyLoshonKodeshReplacementsDetailed,
} from '@/lib/loshonKodesh';
import { normalizeHebrewFinalLettersDetailed } from '@/lib/hebrewOrthography';
import { isPersonalPronunciationEnabled } from '@/lib/personalPronunciationModel';
import { applyProfileCorrections, isProfileLoshonKodesh } from '@/lib/pronunciationProfiles';
import { applyLearnedCorrections, type AppliedLearnedCorrection } from '@/utils/correctionLearning';
import { applyVocabularyCorrections, isCustomVocabularyEnabled } from '@/utils/customVocabulary';
import { applyDefinitiveRulesToText, areDefinitiveRulesEnabled } from '@/utils/hebrewRuleEngine';
import { wordDiff } from '@/lib/asrMetrics';
import type { TextReplacementOccurrence } from '@/lib/hebrewTextReplacement';
import {
  createTraceOperation,
  createTraceStage,
  findTraceOverlaps,
  validateTraceChain,
  type TranscriptionTraceOperation,
  type TranscriptionTraceOverlap,
  type TranscriptionTraceSource,
  type TranscriptionTraceStage,
} from '@/lib/transcriptionTrace';

export interface TranscriptionKnowledgeResult {
  text: string;
  totalApplied: number;
  deterministicApplied: number;
  learnedApplied: AppliedLearnedCorrection[];
  changes: TranscriptionKnowledgeChange[];
  trace: TranscriptionTraceStage[];
  traceValidationErrors: string[];
  traceOverlaps: TranscriptionTraceOverlap[];
  aiError?: string;
  counts: {
    definitive: number;
    learned: number;
    profile: number;
    vocabulary: number;
    loshonKodesh: number;
    orthography: number;
    ai: number;
  };
}

export type TranscriptionKnowledgeLayer = 'loshon-kodesh' | 'vocabulary' | 'profile' | 'definitive' | 'learned' | 'orthography' | 'ai';

export interface TranscriptionKnowledgeChange {
  layer: TranscriptionKnowledgeLayer;
  from: string;
  to: string;
  count: number;
  ruleId?: string;
}

export interface TranscriptionKnowledgeOptions {
  loshonKodesh?: boolean;
  profileId?: string;
  ai?: boolean;
}

const SOURCES = {
  orthography: {
    system: 'mandatory-hebrew-orthography',
    file: 'src/lib/hebrewOrthography.ts',
    function: 'normalizeHebrewFinalLettersDetailed',
    store: 'hardcoded:MEDIAL_TO_FINAL + FINAL_TO_MEDIAL (canonical)',
  },
  learned: {
    system: 'correction-learning',
    file: 'src/utils/correctionLearning.ts',
    function: 'applyLearnedCorrections',
    store: 'localStorage:transcription_corrections_v2(scope=global)',
  },
  protection: {
    system: 'learned-output-protection',
    file: 'src/lib/transcriptionKnowledge.ts',
    function: 'protectLearnedOutputs',
    store: 'runtime-only private tokens',
  },
  loshonKodesh: {
    system: 'loshon-kodesh-replacements',
    file: 'src/lib/loshonKodesh.ts',
    function: 'applyLoshonKodeshReplacementsDetailed',
    store: 'localStorage:lk_rules_replacements + lk_rules_dictionaries + defaults',
  },
  vocabulary: {
    system: 'custom-vocabulary',
    file: 'src/utils/customVocabulary.ts',
    function: 'applyVocabularyCorrections',
    store: 'localStorage:custom_vocabulary',
  },
  profile: {
    system: 'pronunciation-profile',
    file: 'src/lib/pronunciationProfiles.ts',
    function: 'applyProfileCorrections',
    store: 'localStorage:transcription_corrections_v2(scope=profile)',
  },
  definitive: {
    system: 'definitive-hebrew-rules',
    file: 'src/utils/hebrewRuleEngine.ts',
    function: 'applyDefinitiveRulesToText',
    store: 'hardcoded:DEFINITIVE_RULES',
  },
  ai: {
    system: 'loshon-kodesh-ai',
    file: 'src/lib/loshonKodesh.ts',
    function: 'applyLkAiFix',
    store: 'Supabase Edge Function:loshon-kodesh-ai',
  },
} satisfies Record<string, TranscriptionTraceSource>;

function replaceLiteralDetailed(text: string, before: string, after: string): {
  text: string;
  occurrences: TextReplacementOccurrence[];
} {
  if (!before || !text.includes(before)) return { text, occurrences: [] };
  const occurrences: TextReplacementOccurrence[] = [];
  let inputCursor = 0;
  let outputDelta = 0;
  while (inputCursor <= text.length) {
    const inputStart = text.indexOf(before, inputCursor);
    if (inputStart < 0) break;
    const outputStart = inputStart + outputDelta;
    occurrences.push({
      inputStart,
      inputEnd: inputStart + before.length,
      outputStart,
      outputEnd: outputStart + after.length,
      before,
      after,
    });
    inputCursor = inputStart + before.length;
    outputDelta += after.length - before.length;
  }
  return { text: text.split(before).join(after), occurrences };
}

function protectLearnedOutputs(
  text: string,
  applied: Array<{ corrected: string }>,
): {
  text: string;
  traceOperations: TranscriptionTraceOperation[];
  restore: (value: string) => { text: string; traceOperations: TranscriptionTraceOperation[] };
} {
  const replacements = new Map<string, string>();
  const traceOperations: TranscriptionTraceOperation[] = [];
  let protectedText = text;

  for (const { corrected } of applied) {
    if (!corrected || replacements.has(corrected) || !protectedText.includes(corrected)) continue;
    const token = `\uE000${replacements.size}\uE001`;
    replacements.set(corrected, token);
    const beforeText = protectedText;
    const replacement = replaceLiteralDetailed(protectedText, corrected, token);
    protectedText = replacement.text;
    traceOperations.push(createTraceOperation({
      sequence: traceOperations.length,
      ruleId: `protect-learned:${corrected}`,
      source: SOURCES.protection,
      beforeText,
      afterText: protectedText,
      occurrences: replacement.occurrences,
      metadata: { corrected },
    }));
  }

  return {
    text: protectedText,
    traceOperations,
    restore: (value) => {
      let restored = value;
      const restoreOperations: TranscriptionTraceOperation[] = [];
      for (const [corrected, token] of replacements) {
        const beforeText = restored;
        const replacement = replaceLiteralDetailed(restored, token, corrected);
        restored = replacement.text;
        if (replacement.occurrences.length === 0) continue;
        restoreOperations.push(createTraceOperation({
          sequence: restoreOperations.length,
          ruleId: `restore-learned:${corrected}`,
          source: SOURCES.protection,
          beforeText,
          afterText: restored,
          occurrences: replacement.occurrences,
          metadata: { corrected },
        }));
      }
      return { text: restored, traceOperations: restoreOperations };
    },
  };
}

function traceState(trace: TranscriptionTraceStage[]) {
  return {
    trace,
    traceValidationErrors: validateTraceChain(trace),
    traceOverlaps: findTraceOverlaps(trace),
  };
}

function findRuleId(
  operations: TranscriptionTraceOperation[],
  before: string,
  after: string,
): string | undefined {
  return operations.find(operation => operation.occurrences.some(occurrence => (
    occurrence.before === before && occurrence.after === after
  )))?.ruleId;
}

export function applyTranscriptionKnowledge(
  text: string,
  engine: string,
  options: TranscriptionKnowledgeOptions = {},
): TranscriptionKnowledgeResult {
  const trace: TranscriptionTraceStage[] = [];
  const personalEnabled = isPersonalPronunciationEnabled();

  const preliminaryOrthography = normalizeHebrewFinalLettersDetailed(text);
  trace.push(createTraceStage({
    index: trace.length, id: 'orthography-pre', label: 'בדיקת מנצפך לפני הכללים', enabled: true,
    source: SOURCES.orthography, inputText: text, outputText: preliminaryOrthography.text,
    operations: preliminaryOrthography.traceOperations,
  }));

  const learned = personalEnabled
    ? applyLearnedCorrections(preliminaryOrthography.text, { engine })
    : { text: preliminaryOrthography.text, appliedCount: 0, applied: [], traceOperations: [] };
  trace.push(createTraceStage({
    index: trace.length, id: 'learned-corrections', label: 'תיקונים שנלמדו מהעורך', enabled: personalEnabled,
    reason: personalEnabled ? undefined : 'personal pronunciation learning is disabled', source: SOURCES.learned,
    inputText: preliminaryOrthography.text, outputText: learned.text, operations: learned.traceOperations,
  }));

  const protectedLearned = protectLearnedOutputs(learned.text, learned.applied);
  trace.push(createTraceStage({
    index: trace.length, id: 'learned-protection', label: 'הגנת פלט מתיקון אנושי', enabled: true,
    reason: learned.applied.length > 0 ? undefined : 'no learned output required protection', source: SOURCES.protection,
    inputText: learned.text, outputText: protectedLearned.text, operations: protectedLearned.traceOperations,
  }));

  const lkActive = options.loshonKodesh ?? (isLoshonKodeshEnabled() || isProfileLoshonKodesh(options.profileId));
  const lk = lkActive
    ? applyLoshonKodeshReplacementsDetailed(protectedLearned.text)
    : { text: protectedLearned.text, appliedCount: 0, applied: [], traceOperations: [] };
  trace.push(createTraceStage({
    index: trace.length, id: 'loshon-kodesh', label: 'כללי לשון הקודש', enabled: lkActive,
    reason: lkActive ? undefined : 'Loshon Kodesh mode is disabled for this run', source: SOURCES.loshonKodesh,
    inputText: protectedLearned.text, outputText: lk.text, operations: lk.traceOperations,
  }));

  const vocabularyEnabled = isCustomVocabularyEnabled();
  const vocabulary = vocabularyEnabled
    ? applyVocabularyCorrections(lk.text)
    : { text: lk.text, appliedCount: 0, applied: [], traceOperations: [] };
  trace.push(createTraceStage({
    index: trace.length, id: 'vocabulary', label: 'מילון מונחים מאומת', enabled: vocabularyEnabled,
    reason: vocabularyEnabled ? undefined : 'custom vocabulary is disabled', source: SOURCES.vocabulary,
    inputText: lk.text, outputText: vocabulary.text, operations: vocabulary.traceOperations,
  }));

  const profile = personalEnabled
    ? applyProfileCorrections(vocabulary.text, { profileId: options.profileId })
    : { text: vocabulary.text, appliedCount: 0, applied: [], traceOperations: [] };
  trace.push(createTraceStage({
    index: trace.length, id: 'pronunciation-profile', label: 'פרופיל הגייה אישי', enabled: personalEnabled,
    reason: personalEnabled ? undefined : 'personal pronunciation profiles are disabled', source: SOURCES.profile,
    inputText: vocabulary.text, outputText: profile.text, operations: profile.traceOperations,
  }));

  const definitiveEnabled = areDefinitiveRulesEnabled();
  const definitive = definitiveEnabled
    ? applyDefinitiveRulesToText(profile.text)
    : { fixedText: profile.text, hits: [], traceOperations: [] };
  trace.push(createTraceStage({
    index: trace.length, id: 'definitive-rules', label: 'כללי עברית מוחלטים', enabled: definitiveEnabled,
    reason: definitiveEnabled ? undefined : 'definitive Hebrew rules are disabled', source: SOURCES.definitive,
    inputText: profile.text, outputText: definitive.fixedText, operations: definitive.traceOperations,
  }));

  const restored = protectedLearned.restore(definitive.fixedText);
  trace.push(createTraceStage({
    index: trace.length, id: 'learned-restore', label: 'שחזור תיקונים מוגנים', enabled: true,
    reason: restored.traceOperations.length > 0 ? undefined : 'no protected output required restoration', source: SOURCES.protection,
    inputText: definitive.fixedText, outputText: restored.text, operations: restored.traceOperations,
  }));

  const finalOrthography = normalizeHebrewFinalLettersDetailed(restored.text);
  trace.push(createTraceStage({
    index: trace.length, id: 'orthography-final', label: 'שער מנצפך סופי', enabled: true,
    source: SOURCES.orthography, inputText: restored.text, outputText: finalOrthography.text,
    operations: finalOrthography.traceOperations,
  }));

  const orthographyApplied = preliminaryOrthography.appliedCount + finalOrthography.appliedCount;
  const counts = {
    definitive: definitive.hits.length,
    learned: learned.appliedCount,
    profile: profile.appliedCount,
    vocabulary: vocabulary.appliedCount,
    loshonKodesh: lk.appliedCount,
    orthography: orthographyApplied,
    ai: 0,
  };
  const deterministicApplied = counts.definitive + counts.learned + counts.profile + counts.vocabulary + counts.orthography;
  const changes: TranscriptionKnowledgeChange[] = [
    ...lk.applied.map(change => ({ layer: 'loshon-kodesh' as const, from: change.from, to: change.to, count: change.count, ruleId: findRuleId(lk.traceOperations, change.from, change.to) })),
    ...vocabulary.applied.map(change => ({ layer: 'vocabulary' as const, from: change.original, to: change.corrected, count: change.count, ruleId: findRuleId(vocabulary.traceOperations, change.original, change.corrected) })),
    ...profile.applied.map(change => ({ layer: 'profile' as const, from: change.original, to: change.corrected, count: change.count, ruleId: findRuleId(profile.traceOperations, change.original, change.corrected) })),
    ...definitive.hits.map(hit => ({ layer: 'definitive' as const, from: hit.from, to: hit.to, count: 1, ruleId: hit.ruleId })),
    ...learned.applied.map(change => ({ layer: 'learned' as const, from: change.original, to: change.corrected, count: change.count, ruleId: findRuleId(learned.traceOperations, change.original, change.corrected) })),
    ...preliminaryOrthography.applied.map(change => ({ layer: 'orthography' as const, ...change })),
    ...finalOrthography.applied.map(change => ({ layer: 'orthography' as const, ...change })),
  ];

  return {
    text: finalOrthography.text,
    totalApplied: deterministicApplied + counts.loshonKodesh,
    deterministicApplied,
    learnedApplied: learned.applied,
    changes,
    counts,
    ...traceState(trace),
  };
}

export async function applyTranscriptionKnowledgeWithAi(
  text: string,
  engine: string,
  options: TranscriptionKnowledgeOptions = {},
): Promise<TranscriptionKnowledgeResult> {
  const deterministic = applyTranscriptionKnowledge(text, engine, options);
  const trace = [...deterministic.trace];
  const aiEnabled = Boolean(options.ai && options.loshonKodesh && deterministic.text.trim());

  if (!aiEnabled) {
    trace.push(createTraceStage({
      index: trace.length, id: 'ai-context-fix', label: 'תיקון הקשר באמצעות AI', enabled: false,
      reason: !options.ai ? 'AI correction is disabled' : !options.loshonKodesh ? 'Loshon Kodesh mode is disabled' : 'empty text',
      source: SOURCES.ai, inputText: deterministic.text, outputText: deterministic.text,
    }));
    trace.push(createTraceStage({
      index: trace.length, id: 'orthography-after-ai', label: 'שער מנצפך לאחר AI', enabled: false,
      reason: 'AI stage was skipped', source: SOURCES.orthography,
      inputText: deterministic.text, outputText: deterministic.text,
    }));
    return { ...deterministic, ...traceState(trace) };
  }

  let aiText: string;
  try {
    aiText = (await applyLkAiFix(deterministic.text, { normalizeFinalLetters: false })).trim();
  } catch (error) {
    const aiError = error instanceof Error ? error.message : String(error);
    trace.push(createTraceStage({
      index: trace.length, id: 'ai-context-fix', label: 'תיקון הקשר באמצעות AI', enabled: true,
      error: aiError, source: SOURCES.ai, inputText: deterministic.text, outputText: deterministic.text,
    }));
    trace.push(createTraceStage({
      index: trace.length, id: 'orthography-after-ai', label: 'שער מנצפך לאחר AI', enabled: false,
      reason: 'AI stage failed', source: SOURCES.orthography,
      inputText: deterministic.text, outputText: deterministic.text,
    }));
    return { ...deterministic, aiError, ...traceState(trace) };
  }

  if (!aiText) aiText = deterministic.text;
  const aiOccurrences: TextReplacementOccurrence[] = aiText === deterministic.text ? [] : [{
    inputStart: 0,
    inputEnd: deterministic.text.length,
    outputStart: 0,
    outputEnd: aiText.length,
    before: deterministic.text,
    after: aiText,
    ruleId: 'ai:model-response',
    reason: 'exact provider request/response boundary; internal model reasoning is opaque',
  }];
  const aiOperations = aiOccurrences.length > 0 ? [createTraceOperation({
    sequence: 0,
    ruleId: 'ai:model-response',
    source: SOURCES.ai,
    beforeText: deterministic.text,
    afterText: aiText,
    occurrences: aiOccurrences,
    opaque: true,
  })] : [];
  trace.push(createTraceStage({
    index: trace.length, id: 'ai-context-fix', label: 'תיקון הקשר באמצעות AI', enabled: true,
    reason: aiText === deterministic.text ? 'AI returned identical text' : undefined,
    source: SOURCES.ai, inputText: deterministic.text, outputText: aiText, operations: aiOperations,
  }));

  const finalOrthography = normalizeHebrewFinalLettersDetailed(aiText);
  trace.push(createTraceStage({
    index: trace.length, id: 'orthography-after-ai', label: 'שער מנצפך לאחר AI', enabled: true,
    source: SOURCES.orthography, inputText: aiText, outputText: finalOrthography.text,
    operations: finalOrthography.traceOperations,
  }));

  const aiEditCount = wordDiff(deterministic.text, aiText).filter(operation => operation.type !== 'eq').length;
  return {
    ...deterministic,
    text: finalOrthography.text,
    totalApplied: deterministic.totalApplied + aiEditCount + finalOrthography.appliedCount,
    deterministicApplied: deterministic.deterministicApplied + finalOrthography.appliedCount,
    counts: {
      ...deterministic.counts,
      orthography: deterministic.counts.orthography + finalOrthography.appliedCount,
      ai: aiEditCount,
    },
    changes: [
      ...deterministic.changes,
      ...(aiEditCount > 0 ? [{ layer: 'ai' as const, from: deterministic.text, to: aiText, count: aiEditCount, ruleId: 'ai:model-response' }] : []),
      ...finalOrthography.applied.map(change => ({ layer: 'orthography' as const, ...change })),
    ],
    ...traceState(trace),
  };
}
