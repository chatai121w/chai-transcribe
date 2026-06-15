import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AIUsageRow {
  id: string;
  feature: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
}

export interface AIUsageStats {
  rows: AIUsageRow[];
  totals: {
    calls: number;
    prompt: number;
    completion: number;
    total: number;
  };
  byModel: Record<string, { calls: number; prompt: number; completion: number; total: number }>;
}

function aggregate(rows: AIUsageRow[]): AIUsageStats {
  const totals = { calls: 0, prompt: 0, completion: 0, total: 0 };
  const byModel: AIUsageStats["byModel"] = {};
  for (const r of rows) {
    totals.calls += 1;
    totals.prompt += r.prompt_tokens || 0;
    totals.completion += r.completion_tokens || 0;
    totals.total += r.total_tokens || 0;
    const m = r.model || "unknown";
    byModel[m] ??= { calls: 0, prompt: 0, completion: 0, total: 0 };
    byModel[m].calls += 1;
    byModel[m].prompt += r.prompt_tokens || 0;
    byModel[m].completion += r.completion_tokens || 0;
    byModel[m].total += r.total_tokens || 0;
  }
  return { rows, totals, byModel };
}

/**
 * Fetches AI usage events for the current user, optionally filtered by feature.
 * Returns 30-day window; UI can sub-slice to today/7d/all client-side.
 */
export function useAIUsage(feature?: string) {
  const [rows, setRows] = useState<AIUsageRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      let q = supabase
        .from("ai_usage_events" as never)
        .select("id, feature, model, prompt_tokens, completion_tokens, total_tokens, created_at")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (feature) q = q.eq("feature", feature);
      const { data, error } = await q;
      if (error) throw error;
      setRows((data as unknown as AIUsageRow[]) || []);
    } catch (e) {
      console.warn("useAIUsage load failed", e);
    } finally {
      setLoading(false);
    }
  }, [feature]);

  useEffect(() => {
    load();
    const onUpd = () => load();
    window.addEventListener("ai-usage-updated", onUpd);
    return () => window.removeEventListener("ai-usage-updated", onUpd);
  }, [load]);

  const now = Date.now();
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const last7 = now - 7 * 24 * 60 * 60 * 1000;

  const today = aggregate(rows.filter(r => new Date(r.created_at).getTime() >= todayStart.getTime()));
  const week = aggregate(rows.filter(r => new Date(r.created_at).getTime() >= last7));
  const all = aggregate(rows);

  return { loading, reload: load, today, week, all, raw: rows };
}

export function notifyUsageUpdated() {
  try { window.dispatchEvent(new CustomEvent("ai-usage-updated")); } catch { /* */ }
}
