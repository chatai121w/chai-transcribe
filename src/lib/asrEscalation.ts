export type AsrEscalationRoute = 'accept-primary' | 'retry-local-full' | 'request-teacher';

export interface AsrEscalationInput {
  meanConfidence?: number | null;
  lowConfidenceFraction?: number;
  terminologyRisk?: number;
  priorFailureRate?: number;
  localModelDisagreement?: number;
}

export interface AsrEscalationDecision {
  route: AsrEscalationRoute;
  risk: number;
  reasons: string[];
}

const bounded = (value: number | undefined, fallback = 0): number =>
  Math.max(0, Math.min(1, Number.isFinite(value) ? value as number : fallback));

/** Route expensive engines only to segments with measurable transcription risk. */
export function decideAsrEscalation(input: AsrEscalationInput): AsrEscalationDecision {
  const reasons: string[] = [];
  const confidenceRisk = input.meanConfidence == null ? 0.35 : 1 - bounded(input.meanConfidence);
  const lowConfidenceRisk = bounded(input.lowConfidenceFraction);
  const terminologyRisk = bounded(input.terminologyRisk);
  const historyRisk = bounded(input.priorFailureRate);
  const disagreementRisk = bounded(input.localModelDisagreement);
  if (confidenceRisk >= 0.3) reasons.push('low mean confidence');
  if (lowConfidenceRisk >= 0.25) reasons.push('many low-confidence words');
  if (terminologyRisk >= 0.4) reasons.push('Torah terminology risk');
  if (historyRisk >= 0.35) reasons.push('similar segments failed before');
  if (disagreementRisk >= 0.3) reasons.push('local models disagree');

  const risk = Math.min(1,
    confidenceRisk * 0.3
    + lowConfidenceRisk * 0.25
    + terminologyRisk * 0.2
    + historyRisk * 0.15
    + disagreementRisk * 0.1,
  );
  return {
    route: risk >= 0.52
      ? 'request-teacher'
      : risk >= 0.25
        ? 'retry-local-full'
        : 'accept-primary',
    risk: Number(risk.toFixed(4)),
    reasons,
  };
}
