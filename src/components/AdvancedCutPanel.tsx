/**
 * AdvancedCutPanel — sophisticated audio cutting UI.
 *
 * Modes: manual segments, split by time, split by count.
 * Parallel processing, lazy decode, real-time progress, IndexedDB persistence.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  submitCutJob,
  onCutJobUpdate,
  probeAudioDuration,
  restorePersistedCutJobs,
  removePersistedCutJob,
  generateSegments,
  formatTime,
  parseTimeInput,
  type CutJob,
  type CutJobConfig,
  type CutMode,
  type CutSegment,
  type CutResult,
} from "@/lib/audioCutEngine";
import {
  clearEnhanceQueueCompleted,
  getEnhanceQueueJobs,
  onEnhanceQueueUpdate,
  removeEnhanceQueueJob,
  submitEnhanceJob,
  type EnhanceQueueJob,
} from "@/lib/audioEnhanceQueue";
import { useConversionHistory } from "@/hooks/useConversionHistory";
import { convertAudio, onJobUpdate, type ConversionJob, type OutputFormat } from "@/lib/ffmpegConverter";
import { useTranscriptionJobs } from "@/hooks/useTranscriptionJobs";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import AudioEnhanceDialog from "@/components/AudioEnhanceDialog";
import { toast } from "@/hooks/use-toast";
import {
  Upload,
  Scissors,
  Clock,
  Hash,
  ListOrdered,
  Trash2,
  Download,
  FolderDown,
  Loader2,
  CheckCircle2,
  XCircle,
  Plus,
  X,
  Mic,
  Play,
  Pause,
  FileAudio,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Pencil,
  FolderOpen,
  Save,
  Check,
  Music,
  FileAudio2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Convert helper ──────────────────────────────────────────────────────────

function convertOne(file: File, format: OutputFormat): Promise<File> {
  return new Promise((resolve, reject) => {
    const job = convertAudio(file, format);
    const off = onJobUpdate((j: ConversionJob) => {
      if (j.id !== job.id) return;
      if (j.status === "done" && j.outputBlob) {
        off();
        const ext = format === "mp3" ? "mp3" : format === "opus" ? "opus" : "m4a";
        const outName = file.name.replace(/\.[^/.]+$/, "") + "." + ext;
        resolve(new File([j.outputBlob], outName, { type: j.outputBlob.type }));
      } else if (j.status === "error") {
        off();
        reject(new Error(j.error || "המרה נכשלה"));
      }
    });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + " " + sizes[i];
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = (ms / 1000).toFixed(1);
  return `${secs}s`;
}

// ─── Manual segment row ──────────────────────────────────────────────────────

interface ManualSegmentRow {
  id: string;
  startInput: string;
  endInput: string;
  label: string;
}

function createSegmentRow(startSec = 0, endSec = 0, label = ""): ManualSegmentRow {
  return {
    id: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    startInput: startSec > 0 ? formatTime(startSec) : "0:00",
    endInput: endSec > 0 ? formatTime(endSec) : "",
    label,
  };
}

// ─── Cut Job Status Badge ────────────────────────────────────────────────────

function CutStatusBadge({ status }: { status: CutJob["status"] }) {
  const config: Record<
    CutJob["status"],
    { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ElementType }
  > = {
    queued: { label: "בתור", variant: "secondary", icon: Clock },
    decoding: { label: "מפענח...", variant: "outline", icon: Loader2 },
    cutting: { label: "חותך...", variant: "default", icon: Scissors },
    done: { label: "הושלם", variant: "secondary", icon: CheckCircle2 },
    error: { label: "שגיאה", variant: "destructive", icon: XCircle },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <Badge variant={c.variant} className="gap-1 text-xs">
      <Icon className={cn("w-3 h-3", (status === "decoding" || status === "cutting") && "animate-spin")} />
      {c.label}
    </Badge>
  );
}

// ─── Audio preview player ────────────────────────────────────────────────────

function AudioPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const toggle = useCallback(() => {
    if (!audioRef.current) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setPlaying(!playing);
  }, [playing]);

  if (!url) return null;
  return (
    <div className="flex items-center gap-1">
      <audio
        ref={audioRef}
        src={url}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={toggle}>
        {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </Button>
    </div>
  );
}

// ─── Segment preview list ────────────────────────────────────────────────────

function SegmentPreviewList({
  segments,
  totalDuration,
}: {
  segments: CutSegment[];
  totalDuration: number;
}) {
  if (segments.length === 0) return null;

  return (
    <div className="border rounded-lg bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          תצוגה מקדימה: {segments.length} קטעים
        </span>
        <span className="text-xs text-muted-foreground">
          סה״כ {formatTime(totalDuration)}
        </span>
      </div>
      {/* Timeline bar */}
      <div className="relative h-6 rounded bg-muted overflow-hidden">
        {segments.map((seg, i) => {
          const left = (seg.startSec / totalDuration) * 100;
          const width = ((seg.endSec - seg.startSec) / totalDuration) * 100;
          const colors = [
            "bg-blue-500/60",
            "bg-green-500/60",
            "bg-amber-500/60",
            "bg-purple-500/60",
            "bg-pink-500/60",
            "bg-cyan-500/60",
          ];
          return (
            <div
              key={seg.index}
              className={cn(
                "absolute top-0 h-full border-r border-background/50 flex items-center justify-center text-[9px] font-mono text-white",
                colors[i % colors.length],
              )}
              style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
              title={`${seg.label}: ${formatTime(seg.startSec)} → ${formatTime(seg.endSec)}`}
            >
              {width > 5 && <span>{i + 1}</span>}
            </div>
          );
        })}
      </div>
      {/* Segment list (collapsed if > 6) */}
      <ScrollArea className={cn(segments.length > 6 ? "max-h-32" : "")}>
        <div className="space-y-0.5">
          {segments.map((seg) => (
            <div key={seg.index} className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="h-5 text-[10px] px-1.5 min-w-[2rem] justify-center">
                {seg.index + 1}
              </Badge>
              <span className="font-mono">{formatTime(seg.startSec)} → {formatTime(seg.endSec)}</span>
              <span className="text-muted-foreground/60">({formatTime(seg.endSec - seg.startSec)})</span>
              <span className="truncate">{seg.label}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Cut result card (enhanced with rename, folder, delete, save) ────────────

function CutResultRow({
  result,
  onDownload,
  onTranscribe,
  onEnhance,
  onDelete,
  onSaveToHistory,
}: {
  result: CutResult;
  onDownload: () => void;
  onTranscribe: () => void;
  onEnhance: () => void;
  onDelete: () => void;
  onSaveToHistory: (name: string, folder: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(result.label);
  const [folder, setFolder] = useState("");
  const [showFolder, setShowFolder] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSaveName = () => {
    setIsEditing(false);
  };

  const handleSaveToHistory = () => {
    onSaveToHistory(editName, folder);
    setSaved(true);
    toast({ title: "נשמר להיסטוריה", description: editName });
  };

  return (
    <div className="border rounded-lg p-2.5 space-y-1.5 bg-card/50">
      <div className="flex items-center gap-2">
        <AudioPreview file={result.file} />
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-1">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-7 text-sm"
                dir="rtl"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
              />
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={handleSaveName}>
                <Check className="w-3.5 h-3.5 text-green-500" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <div className="text-sm font-medium truncate" dir="rtl">{editName}</div>
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 opacity-60 hover:opacity-100" onClick={() => setIsEditing(true)}>
                <Pencil className="w-3 h-3" />
              </Button>
            </div>
          )}
          <div className="text-[11px] text-muted-foreground" dir="rtl">
            {formatTime(result.startSec)} → {formatTime(result.endSec)} •{" "}
            {formatTime(result.durationSec)} • {formatBytes(result.sizeBytes)}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button size="icon" variant="ghost" className="h-7 w-7" title="שמור להיסטוריה" onClick={handleSaveToHistory} disabled={saved}>
            {saved ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Save className="w-3.5 h-3.5" />}
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="תיקייה" onClick={() => setShowFolder(!showFolder)}>
            <FolderOpen className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="שפר איכות" onClick={onEnhance}>
            <Sparkles className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="תמלל" onClick={onTranscribe}>
            <Mic className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" title="הורד" onClick={onDownload}>
            <Download className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="מחק" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
      {showFolder && (
        <div className="flex items-center gap-2 pr-8" dir="rtl">
          <FolderOpen className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="שם תיקייה..."
            className="h-7 text-xs flex-1"
            dir="rtl"
          />
        </div>
      )}
    </div>
  );
}
// ─── Cut Job Card ────────────────────────────────────────────────────────────

function CutJobCard({
  job,
  onRemove,
  onDownloadAll,
  onEnhanceAll,
  onTranscribeResult,
  onEnhanceResult,
  onDeleteResult,
  onSaveResultToHistory,
}: {
  job: CutJob;
  onRemove: (id: string) => void;
  onDownloadAll: (job: CutJob) => void;
  onEnhanceAll: (job: CutJob) => void;
  onTranscribeResult: (result: CutResult) => void;
  onEnhanceResult: (result: CutResult) => void;
  onDeleteResult: (jobId: string, segmentIndex: number) => void;
  onSaveResultToHistory: (result: CutResult, name: string, folder: string) => void;
}) {
  const [expanded, setExpanded] = useState(job.status === "done");
  const elapsed =
    job.startedAt && job.finishedAt
      ? formatDuration(job.finishedAt - job.startedAt)
      : job.startedAt
        ? formatDuration(Date.now() - job.startedAt)
        : null;

  const modeLabel = { manual: "ידני", time: "לפי זמן", count: "לפי מספר" }[job.config.mode];

  return (
    <Card className="relative overflow-hidden">
      {(job.status === "cutting" || job.status === "decoding") && (
        <div
          className="absolute bottom-0 left-0 h-1 bg-primary/60 transition-all duration-300"
          style={{ width: `${job.progress}%` }}
        />
      )}
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2" dir="rtl">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <div className="rounded-lg bg-primary/10 p-1.5 shrink-0 mt-0.5">
              <Scissors className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{job.sourceFileName}</p>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground flex-wrap">
                <Badge variant="outline" className="text-[10px] h-4 px-1">
                  {modeLabel}
                </Badge>
                <span>
                  {job.completedSegments}/{job.totalSegments || "?"} קטעים
                </span>
                {elapsed && <span>• {elapsed}</span>}
                {job.durationSec && (
                  <span>• משך: {formatTime(job.durationSec)}</span>
                )}
              </div>
              {(job.status === "cutting" || job.status === "decoding") && (
                <div className="flex items-center gap-2 mt-1.5">
                  <Progress value={job.progress} className="h-1.5 flex-1" />
                  <span className="text-xs font-mono text-muted-foreground w-8 text-left">
                    {job.progress}%
                  </span>
                </div>
              )}
              {job.error && (
                <p className="text-xs text-destructive mt-1">{job.error}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <CutStatusBadge status={job.status} />
            {job.status === "done" && job.results.length > 1 && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="הורד הכל"
                onClick={() => onDownloadAll(job)}
              >
                <FolderDown className="w-3.5 h-3.5" />
              </Button>
            )}
            {job.status === "done" && job.results.length > 0 && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="שפר את כל הקטעים ברקע"
                onClick={() => onEnhanceAll(job)}
              >
                <Sparkles className="w-3.5 h-3.5" />
              </Button>
            )}
            {job.results.length > 0 && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
            )}
            {(job.status === "done" || job.status === "error") && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(job.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        {expanded && job.results.length > 0 && (
          <div className="space-y-1 pt-1 border-t">
            {job.results.map((r) => (
              <CutResultRow
                key={r.segmentIndex}
                result={r}
                onDownload={() => {
                  const url = URL.createObjectURL(r.file);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = r.file.name;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                onTranscribe={() => onTranscribeResult(r)}
                onEnhance={() => onEnhanceResult(r)}
                onDelete={() => onDeleteResult(job.id, r.segmentIndex)}
                onSaveToHistory={(name, folder) => onSaveResultToHistory(r, name, folder)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Panel ──────────────────────────────────────────────────────────────

interface AdvancedCutPanelProps {
  /** Pre-selected source file (e.g. from conversion tab) */
  initialFile?: File;
  initialSourceLabel?: string;
  /** Converted files available to pick from */
  convertedFiles?: Array<{ id: string; name: string; file: File }>;
}

export default function AdvancedCutPanel({
  initialFile,
  initialSourceLabel,
  convertedFiles = [],
}: AdvancedCutPanelProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Source state
  const [sourceFile, setSourceFile] = useState<File | null>(initialFile ?? null);
  const [sourceLabel, setSourceLabel] = useState(initialSourceLabel ?? "");
  const [sourceDuration, setSourceDuration] = useState<number | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [enhanceTarget, setEnhanceTarget] = useState<CutResult | null>(null);

  // Mode
  const [cutMode, setCutMode] = useState<CutMode>("manual");

  // Manual mode rows
  const [manualRows, setManualRows] = useState<ManualSegmentRow[]>([createSegmentRow()]);

  // Time mode
  const [chunkMinutes, setChunkMinutes] = useState("5");
  const [chunkSeconds, setChunkSeconds] = useState("0");

  // Count mode
  const [partCount, setPartCount] = useState("2");

  // Jobs
  const [cutJobs, setCutJobs] = useState<CutJob[]>([]);
  const [enhanceQueueJobs, setEnhanceQueueJobs] = useState<EnhanceQueueJob[]>(() => getEnhanceQueueJobs());

  // Set initial file
  useEffect(() => {
    if (initialFile) {
      void loadSource(initialFile, initialSourceLabel || initialFile.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  // Restore persisted jobs on mount
  useEffect(() => {
    restorePersistedCutJobs().then((restored) => {
      if (restored.length > 0) {
        setCutJobs((prev) => [...prev, ...restored]);
      }
    });
  }, []);

  // Listen to job updates
  useEffect(() => {
    const unsub = onCutJobUpdate((updatedJob) => {
      setCutJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === updatedJob.id);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = updatedJob;
        return next;
      });

      if (updatedJob.status === "done") {
        toast({
          title: "חיתוך הושלם",
          description: `${updatedJob.completedSegments} קטעים נוצרו מ-${updatedJob.sourceFileName}`,
        });
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    return onEnhanceQueueUpdate((nextJobs) => {
      setEnhanceQueueJobs(nextJobs);
    });
  }, []);

  const loadSource = useCallback(async (file: File, label?: string) => {
    setSourceFile(file);
    setSourceLabel(label || file.name);
    setIsProbing(true);
    try {
      const duration = await probeAudioDuration(file);
      setSourceDuration(duration);
      // Auto-set end time for first manual row
      setManualRows((prev) => {
        if (prev.length === 1 && !prev[0].endInput) {
          return [{ ...prev[0], endInput: formatTime(duration) }];
        }
        return prev;
      });
    } catch {
      setSourceDuration(null);
      toast({
        title: "שגיאה בטעינת קובץ",
        description: "לא ניתן לפענח את הקובץ — נסה קובץ אודיו אחר",
        variant: "destructive",
      });
    } finally {
      setIsProbing(false);
    }
  }, []);

  // Compute preview segments
  const previewSegments = useMemo((): CutSegment[] => {
    if (!sourceDuration || sourceDuration <= 0) return [];

    const config = buildConfig();
    if (!config) return [];
    return generateSegments(config, sourceDuration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutMode, manualRows, chunkMinutes, chunkSeconds, partCount, sourceDuration]);

  function buildConfig(): CutJobConfig | null {
    switch (cutMode) {
      case "manual": {
        const segments = manualRows
          .map((row) => {
            const start = parseTimeInput(row.startInput);
            const end = parseTimeInput(row.endInput);
            if (start === null || end === null || end <= start) return null;
            return { startSec: start, endSec: end, label: row.label || undefined };
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);
        if (segments.length === 0) return null;
        return { mode: "manual", segments };
      }
      case "time": {
        const totalSec = (parseFloat(chunkMinutes) || 0) * 60 + (parseFloat(chunkSeconds) || 0);
        if (totalSec <= 0) return null;
        return { mode: "time", chunkDurationSec: totalSec };
      }
      case "count": {
        const count = parseInt(partCount, 10);
        if (!count || count <= 0) return null;
        return { mode: "count", partCount: count };
      }
    }
  }

  const handleSubmitCut = useCallback(() => {
    if (!sourceFile) {
      toast({ title: "לא נבחר קובץ", variant: "destructive" });
      return;
    }
    const config = buildConfig();
    if (!config) {
      toast({
        title: "הגדרות חיתוך לא תקינות",
        description: "בדוק את ערכי ההתחלה/סיום",
        variant: "destructive",
      });
      return;
    }

    const job = submitCutJob(sourceFile, config);
    setCutJobs((prev) => [job, ...prev]);
    toast({ title: "חיתוך נכנס לתור", description: `${sourceFile.name}` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFile, cutMode, manualRows, chunkMinutes, chunkSeconds, partCount]);

  // Manual row management
  const addManualRow = useCallback(() => {
    setManualRows((prev) => {
      const lastRow = prev[prev.length - 1];
      const lastEnd = lastRow ? parseTimeInput(lastRow.endInput) : 0;
      return [...prev, createSegmentRow(lastEnd ?? 0, 0, `חלק ${prev.length + 1}`)];
    });
  }, []);

  const removeManualRow = useCallback((id: string) => {
    setManualRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  }, []);

  const updateManualRow = useCallback((id: string, field: keyof ManualSegmentRow, value: string) => {
    setManualRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }, []);

  // Quick split helpers
  const quickSplitEqual = useCallback((count: number) => {
    if (!sourceDuration) return;
    setCutMode("count");
    setPartCount(String(count));
  }, [sourceDuration]);

  const quickSplitByMinutes = useCallback((minutes: number) => {
    setCutMode("time");
    setChunkMinutes(String(minutes));
    setChunkSeconds("0");
  }, []);

  // Download all results from a job
  const handleDownloadAll = useCallback((job: CutJob) => {
    for (const r of job.results) {
      const url = URL.createObjectURL(r.file);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, []);

  const handleRemoveJob = useCallback((id: string) => {
    setCutJobs((prev) => prev.filter((j) => j.id !== id));
    void removePersistedCutJob(id);
  }, []);

  const handleDeleteResult = useCallback((jobId: string, segmentIndex: number) => {
    setCutJobs((prev) =>
      prev.map((j) =>
        j.id === jobId
          ? { ...j, results: j.results.filter((r) => r.segmentIndex !== segmentIndex) }
          : j
      )
    );
    toast({ title: "הקטע נמחק" });
  }, []);

  const { addItem: addHistoryItem } = useConversionHistory();

  const handleSaveResultToHistory = useCallback(async (result: CutResult, name: string, folder: string) => {
    try {
      await addHistoryItem({
        file_name: name,
        original_name: result.file.name,
        output_format: "wav",
        file_size: result.sizeBytes,
        output_size: result.sizeBytes,
        duration_ms: Math.round(result.durationSec * 1000),
      });
    } catch {
      toast({ title: "שגיאה בשמירה", variant: "destructive" });
    }
  }, [addHistoryItem]);

  const inferOutputFormat = useCallback((fileName: string): "mp3" | "opus" | "aac" => {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".opus")) return "opus";
    if (lower.endsWith(".m4a") || lower.endsWith(".aac")) return "aac";
    return "mp3";
  }, []);

  const handleEnhanceAllResults = useCallback((job: CutJob) => {
    let queued = 0;
    for (const result of job.results) {
      submitEnhanceJob(result.file, {
        preset: "ai_voice",
        outputFormat: inferOutputFormat(result.file.name),
      });
      queued += 1;
    }

    if (queued > 0) {
      toast({
        title: "שיפור אצווה לחיתוך התחיל",
        description: `${queued} קטעים נוספו לתור שיפור רקע`,
      });
    }
  }, [inferOutputFormat]);

  const handleTranscribeResult = useCallback(
    (result: CutResult) => {
      navigate("/transcribe", { state: { file: result.file } });
    },
    [navigate],
  );

  const handleClearDone = useCallback(() => {
    setCutJobs((prev) => {
      const toRemove = prev.filter((j) => j.status === "done" || j.status === "error");
      toRemove.forEach((j) => void removePersistedCutJob(j.id));
      return prev.filter((j) => j.status !== "done" && j.status !== "error");
    });
  }, []);

  const stats = {
    total: cutJobs.length,
    done: cutJobs.filter((j) => j.status === "done").length,
    active: cutJobs.filter((j) => j.status === "cutting" || j.status === "decoding").length,
    queued: cutJobs.filter((j) => j.status === "queued").length,
  };
  const enhanceQueueStats = {
    total: enhanceQueueJobs.length,
    active: enhanceQueueJobs.filter((j) => j.status === "enhancing").length,
    queued: enhanceQueueJobs.filter((j) => j.status === "queued").length,
    done: enhanceQueueJobs.filter((j) => j.status === "done").length,
    errors: enhanceQueueJobs.filter((j) => j.status === "error").length,
  };

  return (
    <div className="space-y-4">
      {/* Source selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Scissors className="w-4 h-4 text-primary" />
            מערכת חיתוך מתקדמת
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File source */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4" />
              בחר קובץ
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadSource(f);
                e.target.value = "";
              }}
            />
            {convertedFiles.length > 0 && (
              <span className="text-xs text-muted-foreground">או בחר מהומרים:</span>
            )}
            {convertedFiles.slice(0, 6).map((cf) => (
              <Button
                key={cf.id}
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => void loadSource(cf.file, `${cf.name} (מומר)`)}
              >
                {cf.name.replace(/\.[^/.]+$/, "")}
              </Button>
            ))}
          </div>

          {/* Source info */}
          {sourceFile && (
            <div className="flex items-center gap-2 text-sm bg-muted/30 rounded-lg px-3 py-2">
              <FileAudio className="w-4 h-4 text-primary shrink-0" />
              <span className="font-medium truncate">{sourceLabel}</span>
              {isProbing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {sourceDuration !== null && (
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {formatTime(sourceDuration)}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{formatBytes(sourceFile.size)}</span>
            </div>
          )}

          {sourceFile && sourceDuration !== null && (
            <>
              {/* Quick actions */}
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-muted-foreground self-center ml-1">חלוקה מהירה:</span>
                {[2, 3, 4, 5, 10].map((n) => (
                  <Button
                    key={n}
                    variant={cutMode === "count" && partCount === String(n) ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => quickSplitEqual(n)}
                  >
                    {n} חלקים
                  </Button>
                ))}
                <span className="text-xs text-muted-foreground self-center mr-2 ml-1">|</span>
                {[1, 3, 5, 10, 15, 30].map((m) => (
                  <Button
                    key={m}
                    variant={cutMode === "time" && chunkMinutes === String(m) && chunkSeconds === "0" ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => quickSplitByMinutes(m)}
                  >
                    כל {m} דק׳
                  </Button>
                ))}
              </div>

              {/* Mode Tabs */}
              <div className="flex gap-1 border rounded-lg p-1 bg-muted/20">
                {(
                  [
                    { mode: "manual" as CutMode, icon: ListOrdered, label: "ידני" },
                    { mode: "time" as CutMode, icon: Clock, label: "לפי זמן" },
                    { mode: "count" as CutMode, icon: Hash, label: "לפי מספר" },
                  ] as const
                ).map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    onClick={() => setCutMode(mode)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                      cutMode === mode
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Mode-specific config */}
              <div className="border rounded-lg p-3 space-y-3">
                {cutMode === "manual" && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">קטעים לחיתוך</Label>
                      <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={addManualRow}>
                        <Plus className="w-3 h-3" />
                        הוסף קטע
                      </Button>
                    </div>
                    {manualRows.map((row, i) => (
                      <div key={row.id} className="flex items-center gap-2">
                        <Badge variant="outline" className="h-6 w-6 p-0 justify-center text-[10px] shrink-0">
                          {i + 1}
                        </Badge>
                        <div className="flex-1 grid grid-cols-3 gap-1.5">
                          <div>
                            <Input
                              placeholder="0:00"
                              value={row.startInput}
                              onChange={(e) => updateManualRow(row.id, "startInput", e.target.value)}
                              className="h-7 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <Input
                              placeholder={sourceDuration ? formatTime(sourceDuration) : "סוף"}
                              value={row.endInput}
                              onChange={(e) => updateManualRow(row.id, "endInput", e.target.value)}
                              className="h-7 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <Input
                              placeholder={`חלק ${i + 1}`}
                              value={row.label}
                              onChange={(e) => updateManualRow(row.id, "label", e.target.value)}
                              className="h-7 text-xs"
                            />
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                          disabled={manualRows.length <= 1}
                          onClick={() => removeManualRow(row.id)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                    <p className="text-[10px] text-muted-foreground">
                      פורמט: שניות (90), דקות:שניות (1:30), או שעות:דקות:שניות (1:30:00)
                    </p>
                  </div>
                )}

                {cutMode === "time" && (
                  <div className="space-y-3">
                    <Label className="text-xs font-medium">חלק כל:</Label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-[10px] text-muted-foreground">דקות</Label>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={chunkMinutes}
                          onChange={(e) => setChunkMinutes(e.target.value)}
                          className="h-8"
                        />
                      </div>
                      <span className="mt-4 text-muted-foreground">:</span>
                      <div className="flex-1 space-y-1">
                        <Label className="text-[10px] text-muted-foreground">שניות</Label>
                        <Input
                          type="number"
                          min="0"
                          max="59"
                          step="1"
                          value={chunkSeconds}
                          onChange={(e) => setChunkSeconds(e.target.value)}
                          className="h-8"
                        />
                      </div>
                    </div>
                    {(() => {
                      const totalChunkSec = (parseFloat(chunkMinutes) || 0) * 60 + (parseFloat(chunkSeconds) || 0);
                      if (totalChunkSec > 0 && sourceDuration) {
                        const count = Math.ceil(sourceDuration / totalChunkSec);
                        return (
                          <p className="text-xs text-muted-foreground">
                            יווצרו <strong>{count}</strong> קטעים של{" "}
                            <strong>{formatTime(totalChunkSec)}</strong> כל אחד
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                )}

                {cutMode === "count" && (
                  <div className="space-y-3">
                    <Label className="text-xs font-medium">מספר חלקים שווים:</Label>
                    <div className="flex items-center gap-3">
                      <Slider
                        min={2}
                        max={Math.min(50, Math.ceil(sourceDuration ?? 60))}
                        step={1}
                        value={[parseInt(partCount, 10) || 2]}
                        onValueChange={([v]) => setPartCount(String(v))}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        min="1"
                        max="100"
                        value={partCount}
                        onChange={(e) => setPartCount(e.target.value)}
                        className="h-8 w-20"
                      />
                    </div>
                    {sourceDuration && parseInt(partCount, 10) > 0 && (
                      <p className="text-xs text-muted-foreground">
                        כל חלק:{" "}
                        <strong>
                          {formatTime(sourceDuration / parseInt(partCount, 10))}
                        </strong>
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Segment preview */}
              <SegmentPreviewList
                segments={previewSegments}
                totalDuration={sourceDuration}
              />

              {/* Submit button */}
              <div className="flex items-center gap-2">
                <Button
                  className="gap-2"
                  disabled={!sourceFile || previewSegments.length === 0}
                  onClick={handleSubmitCut}
                >
                  <Scissors className="w-4 h-4" />
                  חתוך {previewSegments.length} קטעים
                </Button>
                {previewSegments.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    עיבוד מקבילי — עד {Math.min(4, previewSegments.length)} בו-זמנית
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Jobs list */}
      {cutJobs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileAudio className="w-4 h-4" />
                תוצאות חיתוך ({cutJobs.length})
              </span>
              <div className="flex items-center gap-2">
                {stats.active > 0 && (
                  <Badge variant="default" className="gap-1 text-[10px]">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {stats.active} פעילים
                  </Badge>
                )}
                {stats.queued > 0 && (
                  <Badge variant="outline" className="text-[10px]">
                    {stats.queued} בתור
                  </Badge>
                )}
                {(stats.done > 0 || cutJobs.some((j) => j.status === "error")) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1 text-muted-foreground"
                    onClick={handleClearDone}
                  >
                    <Trash2 className="w-3 h-3" />
                    נקה
                  </Button>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
              <div className="space-y-2 pb-1">
                {cutJobs.map((job) => (
                  <CutJobCard
                    key={job.id}
                    job={job}
                    onRemove={handleRemoveJob}
                    onDownloadAll={handleDownloadAll}
                    onEnhanceAll={handleEnhanceAllResults}
                    onTranscribeResult={handleTranscribeResult}
                    onEnhanceResult={setEnhanceTarget}
                    onDeleteResult={handleDeleteResult}
                    onSaveResultToHistory={handleSaveResultToHistory}
                  />
                ))}
              </div>
          </CardContent>
        </Card>
      )}

{/* enhance queue panel removed per user request */}

      <AudioEnhanceDialog
        open={!!enhanceTarget}
        onOpenChange={(open) => {
          if (!open) setEnhanceTarget(null);
        }}
        file={enhanceTarget?.file ?? null}
        sourceLabel={enhanceTarget?.label}
        defaultOutputFormat={enhanceTarget?.file.name.toLowerCase().endsWith(".opus") ? "opus" : enhanceTarget?.file.name.toLowerCase().endsWith(".m4a") ? "aac" : "mp3"}
        onTranscribe={(file) => navigate("/transcribe", { state: { file } })}
      />
    </div>
  );
}
