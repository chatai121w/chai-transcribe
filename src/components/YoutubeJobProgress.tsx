import { Card } from "@/components/ui/card";
import { CheckCircle2, Loader2, AlertTriangle, Download, FileAudio, Cloud, Search, Circle } from "lucide-react";
import { computeOverall, type JobRecord } from "@/lib/jobs/types";

interface YoutubeJobProgressProps {
  job: JobRecord;
}

type StageKey = 'probe' | 'download' | 'extract_audio' | 'upload_audio' | 'transcribe';

const STAGE_LABELS: Array<{ key: StageKey; label: string; icon: React.ReactNode }> = [
  { key: 'probe', label: 'בדיקת קישור', icon: <Search className="w-3.5 h-3.5" /> },
  { key: 'download', label: 'הורדה', icon: <Download className="w-3.5 h-3.5" /> },
  { key: 'extract_audio', label: 'חילוץ אודיו', icon: <FileAudio className="w-3.5 h-3.5" /> },
  { key: 'upload_audio', label: 'העלאה לענן', icon: <Cloud className="w-3.5 h-3.5" /> },
  { key: 'transcribe', label: 'תמלול', icon: <FileAudio className="w-3.5 h-3.5" /> },
];

function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

/**
 * One continuous, numbered progress readout for a YouTube job.
 *
 * The job runs as a chain of stages, each reporting its own percentage; this
 * collapses them into a single number that only ever moves forward, plus the
 * live detail of whatever stage is currently working (download throughput or
 * transcription position in the audio).
 */
export function YoutubeJobProgress({ job }: YoutubeJobProgressProps) {
  const stages = job.stages ?? [];
  const byKey = (key: StageKey) => stages.find(s => s.key === key);

  const download = byKey('download');
  const meta = (download?.meta ?? {}) as {
    server_status?: string; server_pct?: number;
    dl_mb?: number; total_mb?: number; speed_mb?: number;
    transcribe_sec?: number; transcribe_total_sec?: number; transcribe_segments?: number;
  };

  const isError = job.status === 'error' || stages.some(s => s.status === 'failed');
  const isDone = job.status === 'done';

  // The local server drives most of the work and reports a single 0–100 that
  // already spans download and transcription; prefer it when present.
  const serverPct = Number(meta.server_pct) || 0;
  const overall = isDone ? 100 : Math.max(serverPct, computeOverall(stages));

  const serverStatus = meta.server_status;
  const transcribing = serverStatus === 'transcribing';
  const stageLabel = isError ? 'שגיאה'
    : isDone ? 'הושלם'
    : transcribing ? 'מתמלל'
    : serverStatus === 'downloading' ? 'מוריד'
    : STAGE_LABELS.find(s => byKey(s.key)?.status === 'running')?.label
      ?? 'מתחיל...';

  const detail = (() => {
    if (isDone) return 'כל הקבצים מוכנים';
    if (isError) return job.last_error || 'המשימה נכשלה';
    if (transcribing && (meta.transcribe_total_sec ?? 0) > 0) {
      return `${fmtClock(meta.transcribe_sec ?? 0)} / ${fmtClock(meta.transcribe_total_sec ?? 0)} מהאודיו`
        + (meta.transcribe_segments ? ` · ${meta.transcribe_segments} מקטעים` : '');
    }
    if ((meta.total_mb ?? 0) > 0) {
      return `${(meta.dl_mb ?? 0).toFixed(1)} / ${(meta.total_mb ?? 0).toFixed(1)} MB`
        + ((meta.speed_mb ?? 0) > 0 ? ` · ${(meta.speed_mb ?? 0).toFixed(1)} MB/s` : '');
    }
    return 'מכין...';
  })();

  return (
    <Card className="p-4" dir="rtl">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {isError ? <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
            : isDone ? <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
            : <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
          <span className="font-medium text-sm truncate">{stageLabel}</span>
        </div>
        <div className="flex items-baseline gap-1 shrink-0">
          <span className={`text-2xl font-bold tabular-nums leading-none ${isError ? 'text-destructive' : 'text-primary'}`}>
            {overall}
          </span>
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </div>

      {/* Continuous bar */}
      <div className="relative h-3 rounded-full bg-muted overflow-hidden">
        <div
          className={`absolute top-0 right-0 h-full rounded-full transition-[width] duration-500 ease-out ${
            isError ? 'bg-destructive' : isDone ? 'bg-green-500' : 'bg-primary'
          }`}
          style={{ width: `${Math.max(overall, 2)}%` }}
        >
          {!isDone && !isError && <div className="absolute inset-0 bg-white/20 animate-pulse" />}
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-1.5">{detail}</p>

      {/* Stage chain */}
      <div className="flex flex-wrap items-center gap-1.5 mt-3">
        {STAGE_LABELS.map(({ key, label, icon }) => {
          const stage = byKey(key);
          if (!stage || stage.status === 'skipped') return null;
          const done = stage.status === 'done';
          const running = stage.status === 'running';
          const failed = stage.status === 'failed';
          return (
            <span
              key={key}
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border ${
                failed ? 'border-destructive/40 text-destructive'
                  : done ? 'border-green-500/40 text-green-700 dark:text-green-300'
                  : running ? 'border-primary/50 text-primary'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {failed ? <AlertTriangle className="w-3 h-3" />
                : done ? <CheckCircle2 className="w-3 h-3" />
                : running ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Circle className="w-3 h-3" />}
              {icon}
              {label}
            </span>
          );
        })}
      </div>
    </Card>
  );
}
