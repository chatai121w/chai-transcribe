import type { RetranscriptionWordTiming } from '@/lib/retranscriptionRunner';
import { buildAdjudicationUnits, type AdjudicationUnit } from '@/lib/textAdjudication';

export type AsrReviewChoice = 'source' | 'baseline' | 'candidate' | 'custom';

export type AsrReviewErrorType =
  | 'asr-word'
  | 'torah-term'
  | 'aramaic'
  | 'name'
  | 'punctuation'
  | 'segmentation'
  | 'editorial'
  | 'other';

export interface AsrReviewUnit {
  id: string;
  index: number;
  kind: AdjudicationUnit['kind'];
  sourceText: string;
  baselineText: string;
  candidateText: string;
  start?: number;
  end?: number;
  timingSource?: 'baseline' | 'candidate';
}

export interface AsrHumanReviewRecord {
  schemaVersion: 1;
  id: string;
  experimentId: string;
  unitIds: string[];
  choice: AsrReviewChoice;
  correctedText: string;
  sourceText: string;
  baselineText: string;
  candidateText: string;
  errorType: AsrReviewErrorType;
  notes: string;
  start?: number;
  end?: number;
  timingSource?: 'baseline' | 'candidate';
  baselineEngine: string;
  candidateEngine: string;
  approvedForGold: boolean;
  createdAt: string;
}

function relatedBaselineUnits(unit: AdjudicationUnit, baselineUnits: AdjudicationUnit[]) {
  if (unit.leftStart === unit.leftEnd) {
    return baselineUnits.filter((other) =>
      other.leftStart === other.leftEnd && other.leftStart === unit.leftStart,
    );
  }
  return baselineUnits.filter((other) =>
    other.leftStart < unit.leftEnd && other.leftEnd > unit.leftStart,
  );
}

function timingRange(
  timings: RetranscriptionWordTiming[],
  startIndex: number,
  endIndex: number,
): { start: number; end: number } | null {
  const selected = timings.slice(startIndex, endIndex).filter((timing) =>
    Number.isFinite(timing.start) && Number.isFinite(timing.end) && timing.end > timing.start,
  );
  if (!selected.length) return null;
  return {
    start: Math.min(...selected.map((timing) => timing.start)),
    end: Math.max(...selected.map((timing) => timing.end)),
  };
}

export function buildAsrReviewUnits(
  sourceText: string,
  baselineText: string,
  candidateText: string,
  baselineTimings: RetranscriptionWordTiming[] = [],
  candidateTimings: RetranscriptionWordTiming[] = [],
): AsrReviewUnit[] {
  const sourceToBaseline = buildAdjudicationUnits(sourceText, baselineText, { mergeEqual: false });
  const sourceToCandidate = buildAdjudicationUnits(sourceText, candidateText, { mergeEqual: false });

  return sourceToCandidate.map((unit, index) => {
    const baselineUnits = relatedBaselineUnits(unit, sourceToBaseline);
    const baselineTextForUnit = baselineUnits.map((other) => other.rightText).join('');
    const candidateTiming = timingRange(candidateTimings, unit.rightStart, unit.rightEnd);
    const baselineTiming = baselineUnits.length
      ? timingRange(
          baselineTimings,
          Math.min(...baselineUnits.map((other) => other.rightStart)),
          Math.max(...baselineUnits.map((other) => other.rightEnd)),
        )
      : null;
    const timing = candidateTiming || baselineTiming;

    return {
      id: `review-${index}`,
      index,
      kind: unit.kind,
      sourceText: unit.leftText,
      baselineText: baselineTextForUnit,
      candidateText: unit.rightText,
      start: timing?.start,
      end: timing?.end,
      timingSource: candidateTiming ? 'candidate' : baselineTiming ? 'baseline' : undefined,
    };
  });
}

export function mergeAsrReviewSelection(units: AsrReviewUnit[], selectedIds: string[]) {
  const selected = units
    .filter((unit) => selectedIds.includes(unit.id))
    .sort((left, right) => left.index - right.index);
  const timed = selected.filter((unit) => Number.isFinite(unit.start) && Number.isFinite(unit.end));
  return {
    unitIds: selected.map((unit) => unit.id),
    sourceText: selected.map((unit) => unit.sourceText).join('').trim(),
    baselineText: selected.map((unit) => unit.baselineText).join('').trim(),
    candidateText: selected.map((unit) => unit.candidateText).join('').trim(),
    start: timed.length ? Math.min(...timed.map((unit) => unit.start as number)) : undefined,
    end: timed.length ? Math.max(...timed.map((unit) => unit.end as number)) : undefined,
    timingSource: timed.every((unit) => unit.timingSource === timed[0]?.timingSource)
      ? timed[0]?.timingSource
      : undefined,
  };
}

export function reviewChoiceText(
  choice: AsrReviewChoice,
  selection: ReturnType<typeof mergeAsrReviewSelection>,
  customText: string,
): string {
  if (choice === 'source') return selection.sourceText;
  if (choice === 'baseline') return selection.baselineText;
  if (choice === 'candidate') return selection.candidateText;
  return customText.trim();
}
