export type CorrectionLearningMode = 'auto' | 'hybrid' | 'manual';
export type CorrectionApprovalDecision = 'apply' | 'queue';

export function decideCorrectionApproval(input: {
  mode: CorrectionLearningMode;
  confidence: number;
  threshold: number;
  occurrences: number;
}): CorrectionApprovalDecision {
  if (input.mode === 'manual') return 'queue';
  if (input.confidence < input.threshold) return 'queue';
  if (input.mode === 'hybrid' && input.occurrences < 2) return 'queue';
  return 'apply';
}
