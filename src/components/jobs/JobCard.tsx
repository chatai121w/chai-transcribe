import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Play, X, Download, Trash2, ExternalLink, RefreshCw } from "lucide-react";
import type { JobRecord } from "@/lib/jobs/types";
import { JobStagesProgress } from "./JobStagesProgress";
import { cancelJob, deleteJob } from "@/lib/jobs/jobOrchestrator";
import { resumeYoutubeJob } from "@/lib/jobs/pipelines/youtubePipeline";
import { toast } from "@/hooks/use-toast";

const KIND_LABEL: Record<string, string> = {
  youtube: "YouTube",
  convert: "המרה",
  cut: "חיתוך",
  transcribe: "תמלול",
};

const STATUS_LABEL: Record<string, { text: string; tone: "default" | "secondary" | "destructive" }> = {
  pending: { text: "ממתין", tone: "secondary" },
  running: { text: "פעיל", tone: "default" },
  done: { text: "הושלם", tone: "default" },
  error: { text: "שגיאה", tone: "destructive" },
  cancelled: { text: "בוטל", tone: "secondary" },
  paused: { text: "מושהה", tone: "secondary" },
};

export function JobCard({ job }: { job: JobRecord }) {
  const isActive = job.status === "running" || job.status === "pending";
  const isFailed = job.status === "error";
  const status = STATUS_LABEL[job.status] ?? { text: job.status, tone: "secondary" as const };

  const onResume = async () => {
    try {
      if (job.job_kind === "youtube") {
        await resumeYoutubeJob(job.id);
        toast({ title: "ממשיך מהשלב שנפל" });
      } else {
        toast({ title: "המשך לסוג זה יתווסף בקרוב", variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "שגיאה בהמשך", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    /*
      min-w-0 ו-overflow-hidden הם מה שמונע מהכרטיס להימתח.
      בלעדיהם שם קובץ ארוך דוחף את הכרטיס מעבר לרוחב הפאנל, והכל
      בפנים נחתך בצד.
    */
    <Card className="min-w-0 space-y-2.5 overflow-hidden p-2.5" dir="rtl">
      <div className="flex min-w-0 items-start gap-2.5">
        {job.thumbnail_url ? (
          <img src={job.thumbnail_url} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
        ) : (
          <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-muted text-[10px] text-muted-foreground">
            {KIND_LABEL[job.job_kind] ?? "Job"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="shrink-0 text-[10px]">{KIND_LABEL[job.job_kind] ?? job.job_kind}</Badge>
            <Badge variant={status.tone} className="shrink-0 text-[10px]">{status.text}</Badge>
            <span className="mr-auto shrink-0 text-xs tabular-nums text-muted-foreground">{job.overall_percent}%</span>
          </div>
          <div className="text-sm font-medium truncate mt-1" title={job.title ?? job.video_title ?? job.url}>
            {job.title ?? job.video_title ?? job.url}
          </div>
          <Progress value={job.overall_percent} className="h-1.5 mt-1.5" />
        </div>
      </div>

      <JobStagesProgress stages={job.stages || []} />

      {job.last_error && (
        <div className="text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded p-2">
          {job.last_error}
        </div>
      )}

      {job.output_files && job.output_files.length > 0 && (
        <div className="flex min-w-0 flex-wrap gap-1">
          {job.output_files.map((f, i) => (
            <Button key={i} variant="outline" size="sm" className="h-7 text-xs" asChild>
              <a href={`${f.url}${f.url.includes('?') ? '&' : '?'}download=1`} target="_blank" rel="noreferrer" download={f.filename}>
                <Download className="w-3 h-3 ml-1" />
                {(f.kind || "file").toUpperCase()}
              </a>
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-1.5">
        {isFailed && (
          <Button variant="default" size="sm" className="h-7 text-xs" onClick={onResume}>
            <Play className="w-3 h-3 ml-1" /> המשך מהשלב שנפל
          </Button>
        )}
        {job.status === "done" && job.job_kind === "youtube" && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onResume}>
            <RefreshCw className="w-3 h-3 ml-1" /> הפעל שוב
          </Button>
        )}
        {isActive && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => cancelJob(job.id)}>
            <X className="w-3 h-3 ml-1" /> בטל
          </Button>
        )}
        {job.url?.startsWith("http") && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
            <a href={job.url} target="_blank" rel="noreferrer" title="פתח מקור"><ExternalLink className="w-3.5 h-3.5" /></a>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive"
          onClick={() => deleteJob(job.id)}
          title="מחק"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </Card>
  );
}
