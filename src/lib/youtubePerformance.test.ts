import { describe, expect, it } from "vitest";
import { compareYoutubePerformance, type YoutubePerformanceMetrics } from "./youtubePerformance";

const stable: YoutubePerformanceMetrics = {
  profile: "stable",
  model: "ivrit-ai/whisper-large-v3-turbo-ct2",
  total_sec: 100,
  transcript_sha256: "same",
};

describe("YouTube performance comparison", () => {
  it("accepts a measurable speed improvement only when the transcript is identical", () => {
    const result = compareYoutubePerformance({ ...stable, profile: "safe-accelerated", total_sec: 80 }, stable);
    expect(result.verdict).toBe("improved");
    expect(result.speedImprovementPct).toBeCloseTo(20);
    expect(result.transcriptIdentical).toBe(true);
  });

  it("flags any transcript change as a regression candidate", () => {
    const result = compareYoutubePerformance({ ...stable, profile: "safe-accelerated", total_sec: 50, transcript_sha256: "changed" }, stable);
    expect(result.verdict).toBe("regression");
    expect(result.transcriptIdentical).toBe(false);
  });

  it("does not compare different models", () => {
    const result = compareYoutubePerformance({ ...stable, profile: "safe-accelerated", model: "other" }, stable);
    expect(result.verdict).toBe("incomparable");
    expect(result.comparable).toBe(false);
  });

  it("treats changes below five percent as timing noise", () => {
    const result = compareYoutubePerformance({ ...stable, profile: "safe-accelerated", total_sec: 97 }, stable);
    expect(result.verdict).toBe("neutral");
  });

  it("never approves a speed result without transcript hashes", () => {
    const result = compareYoutubePerformance(
      { profile: "safe-accelerated", model: "same", total_sec: 50 },
      { profile: "stable", model: "same", total_sec: 100 },
    );

    expect(result.verdict).toBe("incomparable");
    expect(result.comparable).toBe(false);
  });

  it("does not compare a cold model start with a warm model run", () => {
    const result = compareYoutubePerformance(
      { ...stable, profile: "safe-accelerated", model_was_cached: false },
      { ...stable, model_was_cached: true },
    );

    expect(result.verdict).toBe("incomparable");
  });
});
