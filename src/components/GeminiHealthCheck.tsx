import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Stethoscope, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getPersonalGeminiKey } from "@/lib/personalGemini";
import { toast } from "@/hooks/use-toast";

interface CheckResult {
  ok: boolean;
  status: number;
  latencyMs?: number;
  error?: string;
  hint?: string;
  note?: string;
  provider?: string;
  modelFound?: string;
}

interface HealthResponse {
  requestId?: string;
  model?: string;
  hasPersonalKey?: boolean;
  personalAuth?: CheckResult;
  lovable?: CheckResult;
  audioFormat?: CheckResult;
  overall?: string;
  error?: string;
}

export function GeminiHealthCheck({ model }: { model: string }) {
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<HealthResponse | null>(null);

  const run = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLoading(true);
    setRes(null);
    try {
      const apiKey = getPersonalGeminiKey();
      const cleanModel = model.replace(/^google\//, "");
      const { data, error } = await supabase.functions.invoke("gemini-health", {
        body: { apiKey, model: cleanModel },
      });
      if (error) throw error;
      setRes(data as HealthResponse);
      const overall = (data as HealthResponse)?.overall;
      if (overall === "ok") toast({ title: "Gemini תקין ✓", description: `מודל: ${cleanModel}` });
      else toast({ title: "בעיה זוהתה ב-Gemini", description: overall || "raיה פירוט למטה", variant: "destructive" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setRes({ error: msg });
      toast({ title: "בדיקת תקינות נכשלה", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const Row = ({ label, r }: { label: string; r?: CheckResult }) => {
    if (!r) return null;
    const Icon = r.ok ? CheckCircle2 : XCircle;
    const color = r.ok ? "text-emerald-600" : "text-red-600";
    return (
      <div className="flex items-start gap-1.5 text-[10px] leading-tight">
        <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${color}`} />
        <div className="flex-1 min-w-0">
          <div className="font-medium">
            {label} <span className="text-muted-foreground">· {r.status || "—"}{r.latencyMs != null ? ` · ${r.latencyMs}ms` : ""}</span>
          </div>
          {r.note && <div className="text-muted-foreground truncate">{r.note}</div>}
          {r.hint && <div className="text-amber-700 truncate">{r.hint}</div>}
          {r.error && <div className="text-red-600 truncate" title={r.error}>{r.error}</div>}
        </div>
      </div>
    );
  };

  return (
    <div
      className="mt-2 w-full space-y-1.5"
      onClick={(e) => e.preventDefault()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={run}
        disabled={loading}
        className="w-full h-7 text-[10px] gap-1"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Stethoscope className="w-3 h-3" />}
        {loading ? "בודק..." : "בדיקת תקינות"}
      </Button>
      {res && (
        <div className="rounded-md border p-2 space-y-1 bg-background/60 text-right">
          {res.error ? (
            <div className="flex items-center gap-1 text-[10px] text-red-600">
              <XCircle className="w-3 h-3" /> {res.error}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1 text-[10px] font-semibold">
                {res.overall === "ok" ? (
                  <><CheckCircle2 className="w-3 h-3 text-emerald-600" /> תקין</>
                ) : (
                  <><AlertTriangle className="w-3 h-3 text-amber-600" /> {res.overall}</>
                )}
                <span className="text-muted-foreground font-normal ms-auto">{res.model}</span>
              </div>
              {res.hasPersonalKey && <Row label="אימות מפתח אישי" r={res.personalAuth} />}
              <Row label="שער Lovable AI" r={res.lovable} />
              <Row label="פורמט אודיו" r={res.audioFormat} />
              {res.requestId && (
                <div className="text-[9px] text-muted-foreground truncate" title={res.requestId}>
                  req: {res.requestId}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
