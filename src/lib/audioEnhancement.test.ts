import { describe, expect, it } from "vitest";
import { classifyReferenceDelta } from "./audioEnhancement";

describe("audio enhancement regression gate", () => {
  it("marks a strict transcription improvement", () => {
    expect(classifyReferenceDelta(-0.08, -0.03)).toBe("improved");
  });

  it("keeps changes inside the tolerance stable", () => {
    expect(classifyReferenceDelta(0.001, -0.001)).toBe("stable");
  });

  it("blocks approval when either strict metric regresses", () => {
    expect(classifyReferenceDelta(-0.08, 0.01)).toBe("regression");
    expect(classifyReferenceDelta(0.01, -0.08)).toBe("regression");
  });
});
