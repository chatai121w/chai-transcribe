// Default pricing per 1M tokens (USD). Overridable via localStorage.
// Sources: public pricing pages as of mid-2026. Adjust as needed.
export type ModelPricing = {
  inputPer1M: number;   // USD per 1M input tokens
  outputPer1M: number;  // USD per 1M output tokens
};

export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // Google Gemini
  "google/gemini-2.5-flash":        { inputPer1M: 0.30,  outputPer1M: 2.50 },
  "google/gemini-2.5-flash-lite":   { inputPer1M: 0.10,  outputPer1M: 0.40 },
  "google/gemini-2.5-pro":          { inputPer1M: 1.25,  outputPer1M: 10.00 },
  "google/gemini-3-flash-preview":  { inputPer1M: 0.30,  outputPer1M: 2.50 },
  "google/gemini-3.1-pro-preview":  { inputPer1M: 1.25,  outputPer1M: 10.00 },
  "google/gemini-3.5-flash":        { inputPer1M: 0.30,  outputPer1M: 2.50 },
  // OpenAI
  "openai/gpt-5":       { inputPer1M: 1.25,  outputPer1M: 10.00 },
  "openai/gpt-5-mini":  { inputPer1M: 0.25,  outputPer1M: 2.00 },
  "openai/gpt-5-nano":  { inputPer1M: 0.05,  outputPer1M: 0.40 },
};

const LS_PRICING = "ai_pricing_overrides_v1";
const LS_FX = "ai_pricing_usd_to_ils_v1";

export function loadPricingOverrides(): Record<string, ModelPricing> {
  try {
    const raw = localStorage.getItem(LS_PRICING);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, ModelPricing>;
  } catch { return {}; }
}

export function savePricingOverrides(overrides: Record<string, ModelPricing>): void {
  try { localStorage.setItem(LS_PRICING, JSON.stringify(overrides)); } catch { /* */ }
  try { window.dispatchEvent(new CustomEvent("ai-pricing-updated")); } catch { /* */ }
}

export function getPricing(model: string): ModelPricing {
  const overrides = loadPricingOverrides();
  const norm = normalizeModel(model);
  return overrides[norm] || DEFAULT_PRICING[norm] || { inputPer1M: 0, outputPer1M: 0 };
}

export function normalizeModel(m: string): string {
  if (!m) return m;
  if (m.includes("/")) return m;
  // bare names like "gemini-2.5-flash" → assume google/
  if (m.startsWith("gemini")) return `google/${m}`;
  if (m.startsWith("gpt-")) return `openai/${m}`;
  return m;
}

export function calcCostUSD(model: string, promptTokens: number, completionTokens: number): number {
  const p = getPricing(model);
  return (promptTokens * p.inputPer1M + completionTokens * p.outputPer1M) / 1_000_000;
}

export function loadUsdToIls(): number {
  try {
    const v = parseFloat(localStorage.getItem(LS_FX) || "");
    return isFinite(v) && v > 0 ? v : 3.7;
  } catch { return 3.7; }
}

export function saveUsdToIls(rate: number): void {
  try { localStorage.setItem(LS_FX, String(rate)); } catch { /* */ }
  try { window.dispatchEvent(new CustomEvent("ai-pricing-updated")); } catch { /* */ }
}

export function fmtUSD(v: number): string {
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function fmtILS(v: number): string {
  return `₪${v.toFixed(2)}`;
}

export const ALL_KNOWN_MODELS = Object.keys(DEFAULT_PRICING);
