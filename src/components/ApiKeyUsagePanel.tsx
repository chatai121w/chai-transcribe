import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RotateCcw, RefreshCw } from "lucide-react";
import {
  fetchProviderUsage,
  resetKeyUsage,
  keyFingerprint,
  type KeyUsageStats,
  type Provider,
} from "@/lib/apiKeyUsage";

interface Props {
  provider: Provider;
  keysText: string; // newline-separated keys
}

function fmtSeconds(s: number): string {
  if (!s) return "0 דק׳";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} דק׳`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}:${r.toString().padStart(2, "0")} שע׳`;
}

export function ApiKeyUsagePanel({ provider, keysText }: Props) {
  const [stats, setStats] = useState<Record<string, KeyUsageStats>>({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProviderUsage(provider);
      setStats(data);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    load();
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail as { provider?: string } | undefined;
      if (!detail || detail.provider === provider) load();
    };
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    window.addEventListener("api-key-usage-updated", onUpdate);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("api-key-usage-updated", onUpdate);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load, provider]);

  const keys = keysText
    .split(/\r?\n/)
    .map((k) => k.trim())
    .filter(Boolean);

  if (keys.length === 0) return null;

  return (
    <div className="mt-3 space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">ניצול מפתחות (24 שעות אחרונות)</h4>
        <Button type="button" size="sm" variant="ghost" onClick={load} disabled={loading} title="רענן">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {keys.map((k, i) => {
        const fp = keyFingerprint(k);
        const s = stats[fp] ?? { seconds24h: 0, words24h: 0, peakSeconds: 0, peakWords: 0 };
        const pctTime = s.peakSeconds > 0 ? Math.min(100, (s.seconds24h / s.peakSeconds) * 100) : 0;
        const pctWords = s.peakWords > 0 ? Math.min(100, (s.words24h / s.peakWords) * 100) : 0;
        return (
          <div key={fp + i} className="space-y-1.5 rounded border border-border/50 bg-background p-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono" dir="ltr">
                #{i + 1} {fp}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={async () => {
                  if (!confirm(`לאפס סטטיסטיקות עבור מפתח ${fp}?`)) return;
                  await resetKeyUsage(provider, fp);
                  load();
                }}
                title="איפוס"
              >
                <RotateCcw className="h-3.5 w-3.5 ml-1" />
                איפוס
              </Button>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>זמן תמלול: {fmtSeconds(s.seconds24h)} / {fmtSeconds(s.peakSeconds)} שיא</span>
                <span className="font-semibold">{pctTime.toFixed(0)}%</span>
              </div>
              <Progress value={pctTime} className="h-1.5" />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span>מילים: {s.words24h.toLocaleString()} / {s.peakWords.toLocaleString()} שיא</span>
                <span className="font-semibold">{pctWords.toFixed(0)}%</span>
              </div>
              <Progress value={pctWords} className="h-1.5" />
            </div>
          </div>
        );
      })}

      <p className="text-[10px] text-muted-foreground">
        100% = השיא הגבוה ביותר שנצפה ב-24 שעות עבור המפתח. עם הזמן הערך מתכייל אוטומטית.
      </p>
    </div>
  );
}
