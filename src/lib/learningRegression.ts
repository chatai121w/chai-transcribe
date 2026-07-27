import { computeCER, computeWER, type DiffOp, wordDiff } from './asrMetrics';

export type LearningWordStatus = 'improved' | 'regression' | 'still-wrong' | 'stable-correct';

export interface LearningWordResult {
  reference: string;
  baseline: string | null;
  candidate: string | null;
  status: LearningWordStatus;
  changedByCandidate: boolean;
}

export interface LearningRegressionResult {
  baseline: ReturnType<typeof computeWER> & ReturnType<typeof computeCER>;
  candidate: ReturnType<typeof computeWER> & ReturnType<typeof computeCER>;
  words: LearningWordResult[];
  improved: number;
  regressions: number;
  stillWrong: number;
  stableCorrect: number;
  netImprovement: number;
}

function referenceSlots(ops: DiffOp[]): Array<{ reference: string; hypothesis: string | null; correct: boolean }> {
  const slots: Array<{ reference: string; hypothesis: string | null; correct: boolean }> = [];
  for (const op of ops) {
    if (!op.ref) continue;
    slots.push({
      reference: op.ref,
      hypothesis: op.hyp ?? null,
      correct: op.type === 'eq',
    });
  }
  return slots;
}

export function evaluateLearningRegression(
  groundTruth: string,
  baselineText: string,
  candidateText: string,
): LearningRegressionResult {
  const baselineWer = computeWER(groundTruth, baselineText);
  const baselineCer = computeCER(groundTruth, baselineText);
  const candidateWer = computeWER(groundTruth, candidateText);
  const candidateCer = computeCER(groundTruth, candidateText);
  const baselineSlots = referenceSlots(wordDiff(groundTruth, baselineText));
  const candidateSlots = referenceSlots(wordDiff(groundTruth, candidateText));
  const count = Math.max(baselineSlots.length, candidateSlots.length);
  const words: LearningWordResult[] = [];

  for (let index = 0; index < count; index += 1) {
    const base = baselineSlots[index];
    const candidate = candidateSlots[index];
    const reference = candidate?.reference ?? base?.reference ?? '';
    const baselineCorrect = Boolean(base?.correct);
    const candidateCorrect = Boolean(candidate?.correct);
    const status: LearningWordStatus = !baselineCorrect && candidateCorrect
      ? 'improved'
      : baselineCorrect && !candidateCorrect
        ? 'regression'
        : baselineCorrect && candidateCorrect
          ? 'stable-correct'
          : 'still-wrong';

    words.push({
      reference,
      baseline: base?.hypothesis ?? null,
      candidate: candidate?.hypothesis ?? null,
      status,
      changedByCandidate: (base?.hypothesis ?? null) !== (candidate?.hypothesis ?? null),
    });
  }

  const improved = words.filter((word) => word.status === 'improved').length;
  const regressions = words.filter((word) => word.status === 'regression').length;
  const stillWrong = words.filter((word) => word.status === 'still-wrong').length;
  const stableCorrect = words.filter((word) => word.status === 'stable-correct').length;

  return {
    baseline: { ...baselineWer, ...baselineCer },
    candidate: { ...candidateWer, ...candidateCer },
    words,
    improved,
    regressions,
    stillWrong,
    stableCorrect,
    netImprovement: baselineWer.wer - candidateWer.wer,
  };
}
