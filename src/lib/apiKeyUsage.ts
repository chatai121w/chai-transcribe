import { supabase } from "@/integrations/supabase/client";

export type Provider = "groq" | "openai" | "google" | "assemblyai" | "deepgram";

export function keyFingerprint(key: string): string {
  if (!key) return "";
  const k = key.trim();
  if (k.length <= 10) return k;
  return `${k.slice(0, 4)}...${k.slice(-4)}`;
}

export async function recordKeyUsage(
  provider: Provider,
  apiKey: string,
  seconds: number,
  words: number,
): Promise<void> {
  try {
    const { data: u } = await supabase.auth.getUser();
    const user_id = u?.user?.id;
    if (!user_id || !apiKey) return;
    const key_fp = keyFingerprint(apiKey);
    await supabase.from("api_key_usage_events" as any).insert({
      user_id,
      provider,
      key_fp,
      seconds: Math.max(0, Number(seconds) || 0),
      words: Math.max(0, Math.floor(Number(words) || 0)),
    });
    try {
      window.dispatchEvent(new CustomEvent("api-key-usage-updated", { detail: { provider, key_fp } }));
    } catch {
      /* non-browser env */
    }
  } catch {
    /* non-critical */
  }
}

export type KeyUsageStats = {
  seconds24h: number;
  words24h: number;
  peakSeconds: number;
  peakWords: number;
};

/**
 * Fetch per-key stats for a provider:
 * - last 24h totals (per fingerprint)
 * - "peak" = max(seconds in any rolling 24h window observed historically per key).
 *   For simplicity we use max of historical sum per UTC-day per key as a baseline,
 *   so percentage learns the user's "100%" over time.
 */
export async function fetchProviderUsage(
  provider: Provider,
): Promise<Record<string, KeyUsageStats>> {
  const { data: u } = await supabase.auth.getUser();
  const user_id = u?.user?.id;
  if (!user_id) return {};

  const { data: rows } = await supabase
    .from("api_key_usage_events" as any)
    .select("key_fp, seconds, words, created_at")
    .eq("user_id", user_id)
    .eq("provider", provider)
    .order("created_at", { ascending: false })
    .limit(5000);

  const out: Record<string, KeyUsageStats> = {};
  if (!rows) return out;

  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60 * 1000;

  // Bucket per key per UTC day to compute observed peak per 24h window
  const dailyBuckets: Record<string, Record<string, { s: number; w: number }>> = {};

  for (const r of rows as any[]) {
    const fp = r.key_fp as string;
    const t = new Date(r.created_at).getTime();
    const s = Number(r.seconds) || 0;
    const w = Number(r.words) || 0;

    if (!out[fp]) out[fp] = { seconds24h: 0, words24h: 0, peakSeconds: 0, peakWords: 0 };
    if (t >= cutoff24h) {
      out[fp].seconds24h += s;
      out[fp].words24h += w;
    }
    const day = new Date(r.created_at).toISOString().slice(0, 10);
    dailyBuckets[fp] ??= {};
    dailyBuckets[fp][day] ??= { s: 0, w: 0 };
    dailyBuckets[fp][day].s += s;
    dailyBuckets[fp][day].w += w;
  }

  for (const fp of Object.keys(dailyBuckets)) {
    for (const day of Object.keys(dailyBuckets[fp])) {
      const b = dailyBuckets[fp][day];
      if (b.s > out[fp].peakSeconds) out[fp].peakSeconds = b.s;
      if (b.w > out[fp].peakWords) out[fp].peakWords = b.w;
    }
    // Ensure current 24h also counts toward peak
    if (out[fp].seconds24h > out[fp].peakSeconds) out[fp].peakSeconds = out[fp].seconds24h;
    if (out[fp].words24h > out[fp].peakWords) out[fp].peakWords = out[fp].words24h;
  }

  return out;
}

export async function resetKeyUsage(provider: Provider, key_fp: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  const user_id = u?.user?.id;
  if (!user_id) return;
  await supabase
    .from("api_key_usage_events" as any)
    .delete()
    .eq("user_id", user_id)
    .eq("provider", provider)
    .eq("key_fp", key_fp);
}
