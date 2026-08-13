import type { CutSegment } from "./audioCutEngine";

export type AudioSelectionMode = "keep" | "remove" | "split";

export interface AudioRange {
  startSec: number;
  endSec: number;
  label?: string;
}

const EPSILON = 0.01;

export function normalizeAudioRanges(ranges: AudioRange[], durationSec: number): AudioRange[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];

  const sorted = ranges
    .map((range) => ({
      ...range,
      startSec: Math.max(0, Math.min(durationSec, range.startSec)),
      endSec: Math.max(0, Math.min(durationSec, range.endSec)),
    }))
    .filter((range) => Number.isFinite(range.startSec) && Number.isFinite(range.endSec))
    .filter((range) => range.endSec - range.startSec >= EPSILON)
    .sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec);

  const merged: AudioRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.startSec <= previous.endSec + EPSILON) {
      previous.endSec = Math.max(previous.endSec, range.endSec);
      previous.label ||= range.label;
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function complementRanges(ranges: AudioRange[], durationSec: number): AudioRange[] {
  const result: AudioRange[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.startSec > cursor + EPSILON) {
      result.push({ startSec: cursor, endSec: range.startSec });
    }
    cursor = Math.max(cursor, range.endSec);
  }
  if (cursor < durationSec - EPSILON) {
    result.push({ startSec: cursor, endSec: durationSec });
  }
  return result;
}

export function buildAudioEditPlan(
  ranges: AudioRange[],
  durationSec: number,
  mode: AudioSelectionMode,
): CutSegment[] {
  const selected = normalizeAudioRanges(ranges, durationSec);
  let output: AudioRange[];

  if (mode === "keep") {
    output = selected;
  } else if (mode === "remove") {
    output = complementRanges(selected, durationSec);
  } else {
    const boundaries = new Set<number>([0, durationSec]);
    selected.forEach((range) => {
      boundaries.add(range.startSec);
      boundaries.add(range.endSec);
    });
    const ordered = [...boundaries].sort((a, b) => a - b);
    output = ordered.slice(0, -1).map((startSec, index) => ({
      startSec,
      endSec: ordered[index + 1],
    })).filter((range) => range.endSec - range.startSec >= EPSILON);
  }

  return output.map((range, index) => {
    const isSelected = selected.some(
      (candidate) => range.startSec >= candidate.startSec - EPSILON
        && range.endSec <= candidate.endSec + EPSILON,
    );
    const modeLabel = mode === "split"
      ? (isSelected ? "מסומן" : "יתר האודיו")
      : mode === "remove" ? "נשמר" : "מסומן";
    return {
      index,
      startSec: range.startSec,
      endSec: range.endSec,
      label: range.label || `${modeLabel} ${index + 1}`,
    };
  });
}

export function planDuration(segments: Pick<CutSegment, "startSec" | "endSec">[]): number {
  return segments.reduce((total, segment) => total + Math.max(0, segment.endSec - segment.startSec), 0);
}
