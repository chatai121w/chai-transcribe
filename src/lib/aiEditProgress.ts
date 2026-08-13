export interface AIEditProgressSnapshot {
  completedUnits: number;
  totalUnits: number;
  startedAt: number;
  updatedAt: number;
  stage: string;
}

export interface MeasuredProgressMetrics {
  percent: number;
  elapsedSeconds: number;
  estimatedRemainingSeconds: number | null;
}

const CHUNK_SAFE_ACTIONS = new Set([
  'improve',
  'grammar',
  'readable',
  'punctuation',
  'paragraphs',
  'bullets',
  'headings',
  'translate',
  'tone',
]);

export function canChunkAIEdit(action: string): boolean {
  return CHUNK_SAFE_ACTIONS.has(action);
}

export function getMeasuredProgressMetrics(
  snapshot: AIEditProgressSnapshot,
  now = Date.now(),
): MeasuredProgressMetrics {
  const totalUnits = Math.max(1, snapshot.totalUnits);
  const completedUnits = Math.min(Math.max(0, snapshot.completedUnits), totalUnits);
  const elapsedSeconds = Math.max(0, Math.floor((now - snapshot.startedAt) / 1000));
  const percent = Math.round((completedUnits / totalUnits) * 100);

  if (completedUnits === 0 || completedUnits >= totalUnits) {
    return { percent, elapsedSeconds, estimatedRemainingSeconds: completedUnits >= totalUnits ? 0 : null };
  }

  const measuredMs = Math.max(0, snapshot.updatedAt - snapshot.startedAt);
  const averageUnitMs = measuredMs / completedUnits;
  const estimatedRemainingSeconds = Math.max(
    0,
    Math.round((averageUnitMs * (totalUnits - completedUnits)) / 1000),
  );

  return { percent, elapsedSeconds, estimatedRemainingSeconds };
}

export function formatMeasuredDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
