import {
  computeCER,
  computeOrthographicCER,
  computeOrthographicWER,
  computeWER,
} from './asrMetrics';

export interface AsrQualitySample {
  id: string;
  reference: string;
  baseline: string;
  candidate: string;
}

export interface AsrQualityMetrics {
  wer: number;
  cer: number;
  orthographicWer: number;
  orthographicCer: number;
  referenceWords: number;
  referenceChars: number;
}

export interface AsrQualitySampleResult {
  id: string;
  baseline: AsrQualityMetrics;
  candidate: AsrQualityMetrics;
  werDelta: number;
  orthographicWerDelta: number;
  improved: boolean;
  regressed: boolean;
}

export interface AsrQualityGateOptions {
  /** Maximum quality loss allowed per metric. Zero means no measurable regression. */
  maxAbsoluteRegression?: number;
  /** Optional minimum strict-WER improvement required for the whole evaluation set. */
  minOrthographicWerImprovement?: number;
}

export interface AsrQualityGateResult {
  passed: boolean;
  baseline: AsrQualityMetrics;
  candidate: AsrQualityMetrics;
  werImprovement: number;
  cerImprovement: number;
  orthographicWerImprovement: number;
  orthographicCerImprovement: number;
  improvedSamples: number;
  regressedSamples: string[];
  reasons: string[];
  samples: AsrQualitySampleResult[];
}

interface MetricTotals {
  wordErrors: number;
  strictWordErrors: number;
  charErrors: number;
  strictCharErrors: number;
  referenceWords: number;
  referenceChars: number;
}

function metrics(reference: string, hypothesis: string): AsrQualityMetrics {
  const wer = computeWER(reference, hypothesis);
  const cer = computeCER(reference, hypothesis);
  const strictWer = computeOrthographicWER(reference, hypothesis);
  const strictCer = computeOrthographicCER(reference, hypothesis);

  return {
    wer: wer.wer,
    cer: cer.cer,
    orthographicWer: strictWer.wer,
    orthographicCer: strictCer.cer,
    referenceWords: wer.refWords,
    referenceChars: cer.refChars,
  };
}

function addTotals(total: MetricTotals, value: AsrQualityMetrics): void {
  total.wordErrors += value.wer * value.referenceWords;
  total.strictWordErrors += value.orthographicWer * value.referenceWords;
  total.charErrors += value.cer * value.referenceChars;
  total.strictCharErrors += value.orthographicCer * value.referenceChars;
  total.referenceWords += value.referenceWords;
  total.referenceChars += value.referenceChars;
}

function aggregate(total: MetricTotals): AsrQualityMetrics {
  return {
    wer: total.referenceWords ? total.wordErrors / total.referenceWords : 0,
    cer: total.referenceChars ? total.charErrors / total.referenceChars : 0,
    orthographicWer: total.referenceWords ? total.strictWordErrors / total.referenceWords : 0,
    orthographicCer: total.referenceChars ? total.strictCharErrors / total.referenceChars : 0,
    referenceWords: total.referenceWords,
    referenceChars: total.referenceChars,
  };
}

const emptyTotals = (): MetricTotals => ({
  wordErrors: 0,
  strictWordErrors: 0,
  charErrors: 0,
  strictCharErrors: 0,
  referenceWords: 0,
  referenceChars: 0,
});

export function evaluateAsrQualityGate(
  input: AsrQualitySample[],
  options: AsrQualityGateOptions = {},
): AsrQualityGateResult {
  const tolerance = Math.max(0, options.maxAbsoluteRegression ?? 0);
  const requiredImprovement = Math.max(0, options.minOrthographicWerImprovement ?? 0);
  const baselineTotals = emptyTotals();
  const candidateTotals = emptyTotals();

  const samples = input.map((sample): AsrQualitySampleResult => {
    const baseline = metrics(sample.reference, sample.baseline);
    const candidate = metrics(sample.reference, sample.candidate);
    addTotals(baselineTotals, baseline);
    addTotals(candidateTotals, candidate);

    const werDelta = candidate.wer - baseline.wer;
    const orthographicWerDelta = candidate.orthographicWer - baseline.orthographicWer;
    const regressed = werDelta > tolerance
      || candidate.cer - baseline.cer > tolerance
      || orthographicWerDelta > tolerance
      || candidate.orthographicCer - baseline.orthographicCer > tolerance;
    const improved = !regressed && (
      werDelta < -tolerance
      || candidate.cer - baseline.cer < -tolerance
      || orthographicWerDelta < -tolerance
      || candidate.orthographicCer - baseline.orthographicCer < -tolerance
    );

    return {
      id: sample.id,
      baseline,
      candidate,
      werDelta,
      orthographicWerDelta,
      improved,
      regressed,
    };
  });

  const baseline = aggregate(baselineTotals);
  const candidate = aggregate(candidateTotals);
  const werImprovement = baseline.wer - candidate.wer;
  const cerImprovement = baseline.cer - candidate.cer;
  const orthographicWerImprovement = baseline.orthographicWer - candidate.orthographicWer;
  const orthographicCerImprovement = baseline.orthographicCer - candidate.orthographicCer;
  const regressedSamples = samples.filter((sample) => sample.regressed).map((sample) => sample.id);
  const reasons: string[] = [];

  if (input.length === 0) reasons.push('evaluation-set-empty');
  if (regressedSamples.length > 0) reasons.push('sample-regression');
  if (werImprovement < -tolerance) reasons.push('aggregate-wer-regression');
  if (cerImprovement < -tolerance) reasons.push('aggregate-cer-regression');
  if (orthographicWerImprovement < -tolerance) reasons.push('aggregate-orthographic-wer-regression');
  if (orthographicCerImprovement < -tolerance) reasons.push('aggregate-orthographic-cer-regression');
  if (orthographicWerImprovement + tolerance < requiredImprovement) reasons.push('required-improvement-not-met');

  return {
    passed: reasons.length === 0,
    baseline,
    candidate,
    werImprovement,
    cerImprovement,
    orthographicWerImprovement,
    orthographicCerImprovement,
    improvedSamples: samples.filter((sample) => sample.improved).length,
    regressedSamples,
    reasons,
    samples,
  };
}
