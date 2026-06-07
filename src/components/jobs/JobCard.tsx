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
    <Card className="p-3 space-y-3" dir="rtl">
      <div className="flex items-start gap-3">
        {job.thumbnail_url ? (
          <img src={job.thumbnail_url} alt="" className="w-16 h-12 object-cover rounded shrink-0" />
        ) : (
          <div className="w-16 h-12 rounded bg-muted shrink-0 flex items-center justify-center text-xs text-muted-foreground">
            {KIND_LABEL[job.job_kind] ?? "Job"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{KIND_LABEL[job.job_kind] ?? job.job_kind}</Badge>
            <Badge variant={status.tone} className="text-[10px]">{status.text}</Badge>
            <span className="text-xs text-muted-foreground tabular-nums mr-auto">{job.overall_percent}%</span>
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
        <div className="flex gap-1 flex-wrap">
          {job.output_files.map((f, i) => (
            <Button key={i} variant="outline" size="sm" className="h-7 text-xs" asChild>
              <a href={f.url} target="_blank" rel="noreferrer" download={f.filename}>
                <Download className="w-3 h-3 ml-1" />
                {(f.kind || "file").toUpperCase()}
              </a>
            </Button>
          ))}
        </div>
      )}

      <div className="flex gap-2 justify-end">
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
