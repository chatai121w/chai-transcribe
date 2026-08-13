import { describe, expect, it } from 'vitest';
import {
  canChunkAIEdit,
  formatMeasuredDuration,
  getMeasuredProgressMetrics,
} from './aiEditProgress';

describe('AI edit measured progress', () => {
  it('uses completed work units for exact percentage and measured ETA', () => {
    const metrics = getMeasuredProgressMetrics({
      completedUnits: 2,
      totalUnits: 5,
      startedAt: 1_000,
      updatedAt: 11_000,
      stage: 'עורך',
    }, 13_000);

    expect(metrics.percent).toBe(40);
    expect(metrics.elapsedSeconds).toBe(12);
    expect(metrics.estimatedRemainingSeconds).toBe(15);
  });

  it('does not invent an ETA before any unit completes', () => {
    const metrics = getMeasuredProgressMetrics({
      completedUnits: 0,
      totalUnits: 1,
      startedAt: 1_000,
      updatedAt: 1_000,
      stage: 'עורך',
    }, 8_000);

    expect(metrics.percent).toBe(0);
    expect(metrics.elapsedSeconds).toBe(7);
    expect(metrics.estimatedRemainingSeconds).toBeNull();
  });

  it('only chunks actions that are safe to process independently', () => {
    expect(canChunkAIEdit('grammar')).toBe(true);
    expect(canChunkAIEdit('translate')).toBe(true);
    expect(canChunkAIEdit('summarize')).toBe(false);
    expect(canChunkAIEdit('custom')).toBe(false);
  });

  it('formats measured durations consistently', () => {
    expect(formatMeasuredDuration(65)).toBe('01:05');
  });
});
