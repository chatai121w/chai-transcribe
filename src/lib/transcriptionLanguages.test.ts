import { describe, expect, it } from "vitest";
import {
  DEFAULT_MULTILINGUAL_CUDA_MODEL,
  getBrowserLanguage,
  normalizeSourceLanguage,
  resolveCudaModel,
  shouldUseHebrewKnowledge,
} from "./transcriptionLanguages";

describe("transcription language policy", () => {
  it("keeps a Hebrew model only when Hebrew is forced", () => {
    const hebrewModel = "ivrit-ai/whisper-large-v3-turbo-ct2";
    expect(resolveCudaModel("he", hebrewModel)).toBe(hebrewModel);
    expect(resolveCudaModel("auto", hebrewModel)).toBe(DEFAULT_MULTILINGUAL_CUDA_MODEL);
    expect(resolveCudaModel("fr", hebrewModel)).toBe(DEFAULT_MULTILINGUAL_CUDA_MODEL);
  });

  it("keeps a multilingual preference for automatic and foreign languages", () => {
    expect(resolveCudaModel("auto", "large-v3")).toBe("large-v3");
    expect(resolveCudaModel("en", "large-v3")).toBe("large-v3");
  });

  it("applies Hebrew learning only to forced or actually detected Hebrew", () => {
    expect(shouldUseHebrewKnowledge("he", "fr")).toBe(true);
    expect(shouldUseHebrewKnowledge("auto", "he")).toBe(true);
    expect(shouldUseHebrewKnowledge("auto", "fr")).toBe(false);
    expect(shouldUseHebrewKnowledge("fr", "he")).toBe(false);
  });

  it("normalizes persisted values and exposes browser locale codes", () => {
    expect(normalizeSourceLanguage("fr")).toBe("fr");
    expect(normalizeSourceLanguage("unknown")).toBe("auto");
    expect(getBrowserLanguage("fr")).toBe("fr-FR");
    expect(getBrowserLanguage("auto")).toBe("");
  });
});
