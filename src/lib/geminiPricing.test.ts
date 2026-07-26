import { describe, expect, it } from "vitest";
import { estimateGeminiCostUsd, getGeminiPrice } from "./geminiPricing";

describe("Gemini multimodal pricing", () => {
  it("uses the official audio input rate for Gemini 2.5 Flash transcription", () => {
    expect(getGeminiPrice("gemini-2.5-flash")).toMatchObject({
      input: 0.30,
      audioInput: 1.00,
      output: 2.50,
    });
    expect(estimateGeminiCostUsd("gemini-2.5-flash", 1_000_000, 0, "audio")).toBe(1);
    expect(estimateGeminiCostUsd("gemini-2.5-flash", 1_000_000, 0, "text")).toBe(0.3);
  });

  it("charges output tokens, including normalized thinking tokens, at output rate", () => {
    expect(estimateGeminiCostUsd("gemini-2.5-flash", 0, 1_000_000, "audio")).toBe(2.5);
  });

  it("uses current Gemini 3 Flash preview rates", () => {
    expect(getGeminiPrice("google/gemini-3-flash-preview")).toMatchObject({
      input: 0.5,
      audioInput: 1,
      output: 3,
    });
  });
});
