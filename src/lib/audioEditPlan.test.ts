import { describe, expect, it } from "vitest";
import { buildAudioEditPlan, normalizeAudioRanges, planDuration } from "./audioEditPlan";

describe("audio edit plan", () => {
  it("normalizes overlapping and out-of-bounds selections", () => {
    expect(normalizeAudioRanges([
      { startSec: 8, endSec: 15 },
      { startSec: -2, endSec: 4 },
      { startSec: 3, endSec: 10 },
    ], 12)).toEqual([{ startSec: 0, endSec: 12 }]);
  });

  it("keeps only selected ranges without overlap", () => {
    const plan = buildAudioEditPlan([
      { startSec: 2, endSec: 4 },
      { startSec: 7, endSec: 9 },
    ], 10, "keep");
    expect(plan.map(({ startSec, endSec }) => [startSec, endSec])).toEqual([[2, 4], [7, 9]]);
    expect(planDuration(plan)).toBe(4);
  });

  it("removes selected ranges and preserves the exact complement", () => {
    const plan = buildAudioEditPlan([
      { startSec: 2, endSec: 4 },
      { startSec: 7, endSec: 9 },
    ], 10, "remove");
    expect(plan.map(({ startSec, endSec }) => [startSec, endSec])).toEqual([[0, 2], [4, 7], [9, 10]]);
    expect(planDuration(plan)).toBe(6);
  });

  it("splits at every boundary and preserves the complete duration", () => {
    const plan = buildAudioEditPlan([
      { startSec: 2, endSec: 4 },
      { startSec: 7, endSec: 9 },
    ], 10, "split");
    expect(plan.map(({ startSec, endSec }) => [startSec, endSec])).toEqual([
      [0, 2], [2, 4], [4, 7], [7, 9], [9, 10],
    ]);
    expect(planDuration(plan)).toBe(10);
  });
});
