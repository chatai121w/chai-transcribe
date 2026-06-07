import { Check, AlertCircle, Loader2, Circle, MinusCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { JobStage } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

export function JobStagesProgress({ stages }: { stages: JobStage[] }) {
  return (
    <div className="space-y-2" dir="rtl">
      {stages.map((s) => {
        const Icon =
          s.status === "done"
            ? Check
            : s.status === "failed"
            ? AlertCircle
            : s.status === "running"
            ? Loader2
            : s.status === "skipped"
            ? MinusCircle
            : Circle;
        const tone =
          s.status === "done"
            ? "text-green-600"
            : s.status === "failed"
            ? "text-destructive"
            : s.status === "running"
            ? "text-primary"
            : s.status === "skipped"
            ? "text-muted-foreground/60"
            : "text-muted-foreground";
        const pct = s.status === "done" || s.status === "skipped" ? 100 : s.percent || 0;
        return (
          <div key={s.key} className="space-y-1">
            <div className="flex items-center gap-2 text-xs">
              <Icon className={cn("w-3.5 h-3.5 shrink-0", tone, s.status === "running" && "animate-spin")} />
              <span className={cn("font-medium", tone)}>{s.label}</span>
              <span className="text-muted-foreground/70 mr-auto tabular-nums">{pct}%</span>
            </div>
            <Progress value={pct} className={cn("h-1", s.status === "failed" && "[&>div]:bg-destructive")} />
            {s.error && <div className="text-[10px] text-destructive truncate" title={s.error}>{s.error}</div>}
          </div>
        );
      })}
    </div>
  );
}
