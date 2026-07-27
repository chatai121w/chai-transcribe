import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLovableGatewayUsage,
  getPersonalGeminiUsage,
  normalizeGeminiUsage,
  recordLovableGatewayUsage,
  recordPersonalGeminiUsage,
} from "./personalGemini";

const store: Record<string, string> = {};

beforeEach(() => {
  Object.keys(store).forEach((key) => delete store[key]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { dispatchEvent: vi.fn() },
  });
});

describe("Gemini usage route separation", () => {
  it("normalizes Google and Lovable token metadata and includes thinking tokens", () => {
    expect(normalizeGeminiUsage({
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 30,
      totalTokenCount: 150,
    })).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(normalizeGeminiUsage({
      prompt_tokens: 80,
      completion_tokens: 25,
      total_tokens: 105,
    })).toEqual({
      promptTokens: 80,
      completionTokens: 25,
      totalTokens: 105,
    });
  });

  it("records personal API usage without changing Lovable usage", () => {
    recordPersonalGeminiUsage("gemini-flash-latest", 120, 30, "transcription");

    expect(getPersonalGeminiUsage()).toMatchObject({
      calls: 1,
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
    });
    expect(getLovableGatewayUsage()).toMatchObject({
      calls: 0,
      totalTokens: 0,
    });
  });

  it("records Lovable usage independently and groups each route by model", () => {
    recordPersonalGeminiUsage("gemini-pro-latest", 200, 50, "editing");
    recordLovableGatewayUsage("gemini-flash-latest", 80, 20, "transcription");
    recordLovableGatewayUsage("gemini-flash-latest", 40, 10, "summary");

    const personal = getPersonalGeminiUsage();
    const lovable = getLovableGatewayUsage();

    expect(personal.totalTokens).toBe(250);
    expect(personal.byModel["gemini-pro-latest"].totalTokens).toBe(250);
    expect(personal.byModel["gemini-flash-latest"]).toBeUndefined();

    expect(lovable.calls).toBe(2);
    expect(lovable.totalTokens).toBe(150);
    expect(lovable.byModel["gemini-flash-latest"]).toMatchObject({
      calls: 2,
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
    });
    expect(lovable.byModel["gemini-pro-latest"]).toBeUndefined();
  });
});
