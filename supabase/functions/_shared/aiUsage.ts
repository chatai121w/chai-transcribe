// Shared helper to log AI usage events from edge functions.
// Uses the user's auth-scoped client so RLS works automatically.
// Safe to call with missing data — never throws.

// Default pricing snapshot per 1M tokens (USD). Mirror of src/lib/aiPricing.ts.
const DEFAULT_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "google/gemini-2.5-flash":        { inputPer1M: 0.30,  outputPer1M: 2.50 },
  "google/gemini-2.5-flash-lite":   { inputPer1M: 0.10,  outputPer1M: 0.40 },
  "google/gemini-2.5-pro":          { inputPer1M: 1.25,  outputPer1M: 10.00 },
  "google/gemini-3-flash-preview":  { inputPer1M: 0.30,  outputPer1M: 2.50 },
  "google/gemini-3.1-pro-preview":  { inputPer1M: 1.25,  outputPer1M: 10.00 },
  "google/gemini-3.5-flash":        { inputPer1M: 0.30,  outputPer1M: 2.50 },
  "openai/gpt-5":       { inputPer1M: 1.25,  outputPer1M: 10.00 },
  "openai/gpt-5-mini":  { inputPer1M: 0.25,  outputPer1M: 2.00 },
  "openai/gpt-5-nano":  { inputPer1M: 0.05,  outputPer1M: 0.40 },
};

function normalizeModel(m: string): string {
  if (!m) return m;
  if (m.includes("/")) return m;
  if (m.startsWith("gemini")) return `google/${m}`;
  if (m.startsWith("gpt-")) return `openai/${m}`;
  return m;
}

function calcCostUSD(model: string, prompt: number, completion: number): number {
  const p = DEFAULT_PRICING[normalizeModel(model)];
  if (!p) return 0;
  return (prompt * p.inputPer1M + completion * p.outputPer1M) / 1_000_000;
}

function trunc(s: string | null | undefined, n = 500): string | null {
  if (!s) return null;
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// deno-lint-ignore no-explicit-any
type UsageInput = {
  supabaseUserClient: any;
  userId: string;
  feature: string;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  } | null;
  promptText?: string | null;       // user prompt / input text
  systemPrompt?: string | null;     // system instruction
  responseText?: string | null;     // model output
  // deno-lint-ignore no-explicit-any
  params?: Record<string, any> | null; // temperature, action, lang, etc.
  durationMs?: number | null;
};

export async function logAIUsage(input: UsageInput): Promise<void> {
  try {
    const u = input.usage || {};
    const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
    const completion = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
    const total = Number(u.total_tokens ?? (prompt + completion)) || 0;
    const cost = calcCostUSD(input.model, prompt, completion);

    await input.supabaseUserClient.from("ai_usage_events").insert({
      user_id: input.userId,
      feature: input.feature,
      model: input.model,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
      prompt_preview: trunc(input.promptText),
      system_prompt: trunc(input.systemPrompt, 1000),
      response_preview: trunc(input.responseText),
      params: input.params ?? null,
      duration_ms: input.durationMs ?? null,
      cost_usd_snapshot: cost > 0 ? Number(cost.toFixed(6)) : null,
    });
  } catch (e) {
    console.warn("[ai-usage] log failed", e);
  }
}
