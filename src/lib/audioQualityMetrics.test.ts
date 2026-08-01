import { describe, expect, it } from "vitest";
import { assessAudioQuality } from "./audioQualityMetrics";

function speechWithNoise(noiseAmplitude: number, seconds = 2, sampleRate = 16000): Float32Array {
  const output = new Float32Array(seconds * sampleRate);
  let seed = 123456789;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0xffffffff * 2 - 1;
  };
  for (let index = 0; index < output.length; index += 1) {
    const time = index / sampleRate;
    const speechOn = Math.floor(time * 4) % 2 === 0;
    const speech = speechOn ? 0.35 * Math.sin(2 * Math.PI * 220 * time) : 0;
    output[index] = speech + random() * noiseAmplitude;
  }
  return output;
}

describe("audio quality regression gate", () => {
  it("detects lower background noise as an improvement", () => {
    const original = speechWithNoise(0.09);
    const processed = speechWithNoise(0.02);
    const result = assessAudioQuality(original, processed, 16000);
    expect(result.verdict).toBe("improved");
    expect(result.estimatedSnrDeltaDb).toBeGreaterThan(5);
    expect(result.noiseFloorDeltaDb).toBeLessThan(-5);
  });

  it("rejects output that loses part of the recording", () => {
    const original = speechWithNoise(0.05);
    const processed = original.slice(0, Math.floor(original.length * 0.7));
    const result = assessAudioQuality(original, processed, 16000);
    expect(result.verdict).toBe("regression");
    expect(result.durationDriftPct).toBeGreaterThan(20);
  });

  it("keeps an unchanged signal stable", () => {
    const original = speechWithNoise(0.04);
    const result = assessAudioQuality(original, original.slice(), 16000);
    expect(result.verdict).toBe("stable");
    expect(result.contentSimilarity).toBeGreaterThan(0.99);
  });
});
