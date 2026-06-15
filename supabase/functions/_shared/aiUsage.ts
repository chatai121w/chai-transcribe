// Shared helper to log AI usage events from edge functions.
// Uses the user's auth-scoped client so RLS works automatically.
// Safe to call with missing data — never throws.

// deno-lint-ignore no-explicit-any
type UsageInput = {
  supabaseUserClient: any; // SupabaseClient with user auth header
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
};

export async function logAIUsage(input: UsageInput): Promise<void> {
  try {
    const u = input.usage || {};
    const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
    const completion = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
    const total = Number(u.total_tokens ?? (prompt + completion)) || 0;
    await input.supabaseUserClient.from("ai_usage_events").insert({
      user_id: input.userId,
      feature: input.feature,
      model: input.model,
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: total,
    });
  } catch (e) {
    console.warn("[ai-usage] log failed", e);
  }
}
