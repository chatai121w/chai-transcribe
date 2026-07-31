import { describe, expect, it } from "vitest";
import {
  BACKGROUND_STORAGE_LIMIT_BYTES,
  getBackgroundEngineLimit,
  validateBackgroundTranscriptionFile,
} from "./backgroundTranscriptionLimits";

const MB = 1024 * 1024;

describe("background transcription file limits", () => {
  it("accepts a compressed file below the provider limit", () => {
    expect(validateBackgroundTranscriptionFile({ size: 20 * MB }, "groq").valid).toBe(true);
  });

  it("rejects a file that the provider cannot receive intact", () => {
    const result = validateBackgroundTranscriptionFile({ size: 25 * MB }, "openai");
    expect(result.valid).toBe(false);
    expect(result.message).toContain("Opus");
  });

  it("allows whole files up to storage capacity for long-form providers", () => {
    expect(getBackgroundEngineLimit("deepgram")).toBe(BACKGROUND_STORAGE_LIMIT_BYTES);
    expect(validateBackgroundTranscriptionFile({ size: 49 * MB }, "assemblyai").valid).toBe(true);
  });

  it("never advertises a limit above cloud storage capacity", () => {
    expect(getBackgroundEngineLimit("unknown")).toBe(BACKGROUND_STORAGE_LIMIT_BYTES);
  });
});
