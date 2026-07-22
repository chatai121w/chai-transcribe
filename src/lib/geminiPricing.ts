/**
 * Gemini API pricing (paid tier), USD per 1,000,000 tokens.
 * Source: https://ai.google.dev/gemini-api/docs/pricing (fetched 2026-07-22).
 *
 * NOTE: Google's free tier is $0. These numbers apply once the project is on
 * the paid tier. They're used to estimate cost from the token counters we
 * already record in `personalGemini.ts`.
 */

export interface GeminiModelPrice {
  /** USD per 1M input tokens (paid tier). */
  input: number;
  /** USD per 1M output tokens (paid tier, incl. thinking tokens). */
  output: number;
  /** Human-readable source label. */
  label: string;
}

/**
 * Keys are normalized model ids (no `google/` prefix, no `models/` prefix).
 * The `-latest` aliases point at the current stable model in that family.
 */
export const GEMINI_PRICING: Record<string, GeminiModelPrice> = {
  // Latest aliases — track the current stable pricing.
  "gemini-flash-latest":    { input: 1.50, output: 7.50,  label: "Gemini 3.6 Flash (latest)" },
  "gemini-pro-latest":      { input: 2.00, output: 12.00, label: "Gemini 3.1 Pro (latest)" },

  // Gemini 3.x
  "gemini-3.6-flash":       { input: 1.50, output: 7.50,  label: "Gemini 3.6 Flash" },
  "gemini-3.5-flash":       { input: 1.50, output: 9.00,  label: "Gemini 3.5 Flash" },
  "gemini-3.5-flash-lite":  { input: 0.15, output: 1.20,  label: "Gemini 3.5 Flash-Lite" },
  "gemini-3.1-pro-preview": { input: 2.00, output: 12.00, label: "Gemini 3.1 Pro Preview" },
  "gemini-3.1-flash-lite":  { input: 0.15, output: 1.20,  label: "Gemini 3.1 Flash-Lite" },
  "gemini-3-flash-preview": { input: 1.50, output: 7.50,  label: "Gemini 3 Flash Preview" },

  // Gemini 2.5.x (still callable for legacy users)
  "gemini-2.5-pro":         { input: 1.25, output: 10.00, label: "Gemini 2.5 Pro" },
  "gemini-2.5-flash":       { input: 0.30, output: 2.50,  label: "Gemini 2.5 Flash" },
  "gemini-2.5-flash-lite":  { input: 0.10, output: 0.40,  label: "Gemini 2.5 Flash-Lite" },

  // Gemini 2.0
  "gemini-2.0-flash":       { input: 0.10, output: 0.40,  label: "Gemini 2.0 Flash" },
  "gemini-2.0-flash-lite":  { input: 0.075, output: 0.30, label: "Gemini 2.0 Flash-Lite" },
};

const FALLBACK_PRICE: GeminiModelPrice = {
  input: 1.50, output: 7.50, label: "Gemini (הערכה)",
};

/** Look up a price row by (possibly prefixed) model id. */
export function getGeminiPrice(model: string): GeminiModelPrice {
  const key = (model || "").replace(/^google\//, "").replace(/^models\//, "").trim();
  if (GEMINI_PRICING[key]) return GEMINI_PRICING[key];
  // Loose match: strip -preview / -exp / date suffixes.
  const loose = key.replace(/-(preview|exp|latest)$/i, "").replace(/-\d{4}$/, "");
  if (loose && GEMINI_PRICING[loose]) return GEMINI_PRICING[loose];
  return FALLBACK_PRICE;
}

/** Compute cost in USD for a given (model, prompt tokens, completion tokens). */
export function estimateGeminiCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = getGeminiPrice(model);
  return (promptTokens / 1_000_000) * p.input + (completionTokens / 1_000_000) * p.output;
}

/** Formats a USD cost with sensible precision (no fake precision on tiny values). */
export function formatUsd(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
