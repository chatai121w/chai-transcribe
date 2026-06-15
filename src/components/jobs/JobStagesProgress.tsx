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

        // Real-time download stats from stage meta
        const meta = (s.meta ?? {}) as Record<string, number | string>;
        const isDownloading = s.key === "download" && s.status === "running";
        const dlMb = Number(meta.dl_mb ?? 0);
        const totalMb = Number(meta.total_mb ?? 0);
        const speedMb = Number(meta.speed_mb ?? 0);
        const serverStatus = meta.server_status as string | undefined;
        const isTranscribing = serverStatus === "transcribing";

        return (
          <div key={s.key} className="space-y-1">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <Icon className={cn("w-3.5 h-3.5 shrink-0", tone, s.status === "running" && "animate-spin")} />
              <span className={cn("font-medium", tone)}>
                {s.label}
                {isDownloading && isTranscribing && (
                  <span className="mr-1 text-muted-foreground font-normal"> — מתמלל…</span>
                )}
              </span>
              {isDownloading && dlMb > 0 && !isTranscribing && (
                <span className="font-mono text-muted-foreground">
                  ⬇ {dlMb.toFixed(1)}{totalMb > 0 ? ` / ${totalMb.toFixed(1)}` : ""} MB
                  {speedMb > 0 && (
                    <span className="text-blue-500 mr-1"> @ {speedMb.toFixed(2)} MB/s</span>
                  )}
                </span>
              )}
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
