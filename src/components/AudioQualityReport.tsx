import { Activity, AlertTriangle, CheckCircle2, HelpCircle, MinusCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AudioQualityAssessment } from "@/lib/audioQualityMetrics";
import { cn } from "@/lib/utils";

const verdictMeta = {
  improved: { label: "שיפור מדיד", icon: CheckCircle2, className: "text-emerald-700 bg-emerald-50 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300" },
  stable: { label: "יציב", icon: MinusCircle, className: "text-blue-700 bg-blue-50 border-blue-300 dark:bg-blue-950/30 dark:text-blue-300" },
  regression: { label: "רגרסיה", icon: AlertTriangle, className: "text-red-700 bg-red-50 border-red-300 dark:bg-red-950/30 dark:text-red-300" },
  inconclusive: { label: "לא חד-משמעי", icon: HelpCircle, className: "text-amber-700 bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300" },
} as const;

function signed(value: number, suffix = ""): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`;
}

export function AudioQualityReport({ assessment }: { assessment: AudioQualityAssessment }) {
  const meta = verdictMeta[assessment.verdict];
  const VerdictIcon = meta.icon;
  const metrics = [
    { id: "snr-delta", label: "שינוי יחס אות לרעש", value: signed(assessment.estimatedSnrDeltaDb, " dB"), good: assessment.estimatedSnrDeltaDb >= 1, bad: assessment.estimatedSnrDeltaDb < -2 },
    { id: "noise-floor-delta", label: "שינוי רצפת רעש", value: signed(assessment.noiseFloorDeltaDb, " dB"), good: assessment.noiseFloorDeltaDb <= -1, bad: assessment.noiseFloorDeltaDb > 3 },
    { id: "content-similarity", label: "דמיון תוכן", value: `${Math.round(assessment.contentSimilarity * 100)}%`, good: assessment.contentSimilarity >= 0.85, bad: assessment.contentSimilarity < 0.55 },
    { id: "duration-drift", label: "סטיית משך", value: `${assessment.durationDriftPct.toFixed(3)}%`, good: assessment.durationDriftPct <= 0.1, bad: assessment.durationDriftPct > 1 },
    { id: "speech-level-delta", label: "שינוי עוצמת דיבור", value: signed(assessment.speechLevelDeltaDb, " dB"), good: Math.abs(assessment.speechLevelDeltaDb) <= 4, bad: assessment.speechLevelDeltaDb < -8 },
    { id: "clipping", label: "קליפינג בפלט", value: `${(assessment.processed.clippingRatio * 100).toFixed(3)}%`, good: assessment.processed.clippingRatio <= assessment.original.clippingRatio, bad: assessment.processed.clippingRatio > 0.001 },
  ];

  return (
    <Card className={cn("border text-right", meta.className)} dir="rtl" data-testid="audio-quality-report">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
          <span className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            שער איכות אובייקטיבי
          </span>
          <span className="flex items-center gap-2">
            <Badge variant="outline" className={cn("gap-1.5", meta.className)} data-testid="audio-quality-verdict">
              <VerdictIcon className="h-3.5 w-3.5" />
              {meta.label}
            </Badge>
            <Badge variant="secondary" data-testid="audio-quality-score">ציון {assessment.score}/100</Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-3 lg:grid-cols-6">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0 bg-background px-3 py-2.5 text-right">
              <p className="truncate text-[11px] text-muted-foreground" title={metric.label}>{metric.label}</p>
              <p dir="ltr" data-testid={`audio-quality-${metric.id}`} className={cn(
                "mt-1 font-mono text-sm font-semibold",
                metric.good && "text-emerald-600 dark:text-emerald-400",
                metric.bad && "text-red-600 dark:text-red-400",
              )}>{metric.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold">ממצאים</p>
            <ul className="space-y-1 text-xs text-foreground/80">
              {assessment.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
            </ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold">מגבלות המדידה</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {assessment.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
