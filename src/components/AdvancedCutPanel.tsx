/**
 * AdvancedCutPanel — sophisticated audio cutting UI.
 *
 * Modes: manual segments, split by time, split by count.
 * Parallel processing, lazy decode, real-time progress, IndexedDB persistence.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  restorePersistedCutJobs,
  removePersistedCutJob,
  persistCompletedCutJob,
  generateSegments,
  formatTime,
  parseTimeInput,
  type CutJob,
  type CutJobConfig,
  type CutMode,
  type CutSegment,
  type CutResult,
} from "@/lib/audioCutEngine";
import { cutWithFallback, probeDurationFast, type CutTier } from "@/lib/tieredCutEngine";
import {
  clearEnhanceQueueCompleted,
  getEnhanceQueueJobs,
  onEnhanceQueueUpdate,
  removeEnhanceQueueJob,
  submitEnhanceJob,
  type EnhanceQueueJob,
} from "@/lib/audioEnhanceQueue";
import { useConversionHistory } from "@/hooks/useConversionHistory";
import { useCloudTranscripts } from "@/hooks/useCloudTranscripts";
import { useFolderTree, type FolderNode } from "@/hooks/useFolderTree";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
  FolderPlus,
  Save,
  Check,
  Music,
  FileAudio2,
  FolderTree,
  Cloud,
  HardDrive,
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

function FolderDestinationTree({
  folders,
  selectedId,
  includeRoot,
  disabled,
  onSelect,
}: {
  folders: FolderNode[];
  selectedId: string;
  includeRoot: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, FolderNode[]>();
    folders.forEach((folder) => {
      const parentId = folder.parent_id || null;
      const children = map.get(parentId) || [];
      children.push(folder);
      map.set(parentId, children);
    });
    map.forEach((children) => children.sort((a, b) => a.name.localeCompare(b.name, "he")));
    return map;
  }, [folders]);

  const renderBranch = (parentId: string | null, depth: number, ancestors: Set<string>): React.ReactNode =>
    (childrenByParent.get(parentId) || []).map((folder) => {
      if (ancestors.has(folder.id)) return null;
      const nextAncestors = new Set(ancestors).add(folder.id);
      const isSelected = selectedId === folder.id;
      return (
        <div key={folder.id}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(folder.id)}
            aria-pressed={isSelected}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border border-transparent py-2 text-right text-sm transition-colors",
              "hover:border-primary/30 hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60",
              isSelected && "border-primary bg-primary/10 text-foreground",
            )}
            style={{ paddingInlineStart: `${12 + depth * 22}px`, paddingInlineEnd: "12px" }}
          >
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                isSelected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50",
              )}
              aria-hidden="true"
            >
              {isSelected && <Check className="h-3 w-3" />}
            </span>
            {folder.emoji
              ? <span className="text-base" aria-hidden="true">{folder.emoji}</span>
              : <FolderOpen className="h-4 w-4 shrink-0 text-primary" />}
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
          </button>
          {renderBranch(folder.id, depth + 1, nextAncestors)}
        </div>
      );
    });

  return (
    <div className="max-h-56 overflow-y-auto rounded-md border bg-background p-1" role="tree" aria-label="עץ תיקיות יעד">
      {includeRoot && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect("__root__")}
          aria-pressed={selectedId === "__root__"}
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-transparent px-3 py-2 text-right text-sm transition-colors",
            "hover:border-primary/30 hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60",
            selectedId === "__root__" && "border-primary bg-primary/10",
          )}
        >
          <span
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
              selectedId === "__root__" ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50",
            )}
            aria-hidden="true"
          >
            {selectedId === "__root__" && <Check className="h-3 w-3" />}
          </span>
          <FolderTree className="h-4 w-4 text-primary" />
          <span>תיקיות ראשיות</span>
        </button>
      )}
      {folders.length > 0
        ? renderBranch(null, 0, new Set())
        : <p className="px-3 py-4 text-center text-xs text-muted-foreground">עדיין אין תיקיות במערכת</p>}
    </div>
  );
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
    <div className="border rounded-xl bg-muted/20 p-3 space-y-2" dir="rtl">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
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
  convertedFile,
  isConverting,
  onDownload,
  onTranscribe,
  onConvert,
  onEnhance,
  onDelete,
  onSaveToHistory,
  selected,
  onToggleSelected,
  onSaveToFolder,
}: {
  result: CutResult;
  convertedFile?: File;
  isConverting?: boolean;
  onDownload: () => void;
  onTranscribe: () => void;
  onConvert: (fmt: OutputFormat) => void;
  onEnhance: () => void;
  onDelete: () => void;
  onSaveToHistory: (name: string, folder: string) => void;
  selected: boolean;
  onToggleSelected: () => void;
  onSaveToFolder: () => void;
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

  const displayFile = convertedFile ?? result.file;

  return (
    <div className="border rounded-xl p-2.5 space-y-1.5 bg-card/50 hover:bg-card/80 transition-colors" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelected}
          aria-label={`בחר קטע ${editName}`}
          className="shrink-0"
        />
        <AudioPreview file={displayFile} />
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
              {convertedFile && (
                <Badge variant="secondary" className="h-4 text-[9px] px-1 shrink-0">
                  {(convertedFile.name.split(".").pop() || "").toUpperCase()}
                </Badge>
              )}
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 opacity-60 hover:opacity-100" onClick={() => setIsEditing(true)}>
                <Pencil className="w-3 h-3" />
              </Button>
            </div>
          )}
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 flex-wrap" dir="ltr" style={{ justifyContent: "flex-end" }}>
            <span className="font-mono">{formatTime(result.startSec)} → {formatTime(result.endSec)}</span>
            <span className="text-muted-foreground/50">•</span>
            <span className="font-mono">{formatTime(result.durationSec)}</span>
            <span className="text-muted-foreground/50">•</span>
            <span>{formatBytes(displayFile.size)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-0.5 flex-wrap justify-end w-full sm:w-auto sm:shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-9 w-9 sm:h-7 sm:w-7" title="המר פורמט" disabled={isConverting}>
                {isConverting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Music className="w-3.5 h-3.5" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">בחר פורמט</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(["mp3", "opus", "aac"] as OutputFormat[]).map((f) => (
                <DropdownMenuItem key={f} onClick={() => onConvert(f)}>
                  {f.toUpperCase()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="icon" variant="ghost" className="h-9 w-9 sm:h-7 sm:w-7" title="שמור להיסטוריה" onClick={handleSaveToHistory} disabled={saved}>
            {saved ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Save className="w-3.5 h-3.5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-9 w-9 sm:h-7 sm:w-7 text-primary"
            title="שמור קטע זה בתיקייה"
            onClick={onSaveToFolder}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 sm:h-7 sm:w-7" title="תיקייה" onClick={() => setShowFolder(!showFolder)}>
            <FolderOpen className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 sm:h-7 sm:w-7" title="שפר איכות" onClick={onEnhance}>
            <Sparkles className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 sm:h-7 sm:w-7" title="תמלל" onClick={onTranscribe}>
            <Mic className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 sm:h-7 sm:w-7" title="הורד" onClick={onDownload}>
            <Download className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 sm:h-7 sm:w-7 text-muted-foreground hover:text-destructive" title="מחק" onClick={onDelete}>
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
  convertedMap,
  segConvertingSet,
  isTranscribingAll,
  isConvertingAll,
  onRemove,
  onDownloadAll,
  onConvertAll,
  onTranscribeAll,
  onConvertResult,
  onEnhanceAll,
  onTranscribeResult,
  onEnhanceResult,
  onDeleteResult,
  onSaveResultToHistory,
  onSaveAllToFolder,
}: {
  job: CutJob;
  convertedMap: Record<string, File>;
  segConvertingSet: Record<string, boolean>;
  isTranscribingAll: boolean;
  isConvertingAll: boolean;
  onRemove: (id: string) => void;
  onDownloadAll: (job: CutJob) => void;
  onConvertAll: (job: CutJob, fmt: OutputFormat) => void;
  onTranscribeAll: (job: CutJob) => void;
  onConvertResult: (jobId: string, segIndex: number, file: File, fmt: OutputFormat) => void;
  onEnhanceAll: (job: CutJob) => void;
  onTranscribeResult: (result: CutResult) => void;
  onEnhanceResult: (result: CutResult) => void;
  onDeleteResult: (jobId: string, segmentIndex: number) => void;
  onSaveResultToHistory: (result: CutResult, name: string, folder: string) => void;
  onSaveAllToFolder: (job: CutJob) => void;
}) {
  const [expanded, setExpanded] = useState(job.status === "done");
  const [selectedSegments, setSelectedSegments] = useState<Set<number>>(new Set());
  const resultIndexes = useMemo(() => job.results.map((result) => result.segmentIndex), [job.results]);
  const allSegmentsSelected = resultIndexes.length > 0 && resultIndexes.every((index) => selectedSegments.has(index));

  useEffect(() => {
    setSelectedSegments((current) => {
      const validIndexes = new Set(resultIndexes);
      return new Set([...current].filter((index) => validIndexes.has(index)));
    });
  }, [resultIndexes]);

  const openFolderDialogForResults = (results: CutResult[]) => {
    if (results.length === 0) return;
    onSaveAllToFolder({ ...job, results });
  };
  const elapsed =
    job.startedAt && job.finishedAt
      ? formatDuration(job.finishedAt - job.startedAt)
      : job.startedAt
        ? formatDuration(Date.now() - job.startedAt)
        : null;

  const modeLabel = { manual: "ידני", time: "לפי זמן", count: "לפי מספר" }[job.config.mode];

  return (
    <Card className="relative overflow-hidden border-border/60 hover:border-primary/30 transition-colors">
      {(job.status === "cutting" || job.status === "decoding") && (
        <div
          className="absolute bottom-0 left-0 h-1 bg-primary/60 transition-all duration-300"
          style={{ width: `${job.progress}%` }}
        />
      )}
      <CardContent className="p-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2" dir="rtl">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <div className="rounded-lg bg-primary/10 p-1.5 shrink-0 mt-0.5">
              <Scissors className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{job.sourceFileName}</p>
              <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 text-xs text-muted-foreground flex-wrap">
                <Badge variant="outline" className="text-[10px] h-4 px-1.5">
                  {modeLabel}
                </Badge>
                {job.engine && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                    {{
                      "wav-slice": "WAV ישיר",
                      "ffmpeg-copy": "FFmpeg ללא קידוד",
                      "audio-buffer": "פיענוח מלא",
                    }[job.engine]}
                  </Badge>
                )}
                <span className="whitespace-nowrap">
                  {job.completedSegments}/{job.totalSegments || "?"} קטעים
                </span>
                {elapsed && <span className="whitespace-nowrap">• {elapsed}</span>}
                {job.durationSec && (
                  <span className="whitespace-nowrap">• משך: {formatTime(job.durationSec)}</span>
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
          <div className="flex items-center gap-1 flex-wrap justify-end w-full sm:w-auto sm:shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0">
            <CutStatusBadge status={job.status} />
            {job.status === "done" && job.results.length > 0 && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 sm:h-7 sm:w-7 text-primary"
                  title="שמור את כל הקטעים בתיקייה"
                  onClick={() => onSaveAllToFolder(job)}
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-9 w-9 sm:h-7 sm:w-7"
                      title="המר את כל הקטעים"
                      disabled={isConvertingAll}
                    >
                      {isConvertingAll
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <FileAudio2 className="w-3.5 h-3.5" />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel className="text-xs">המר את כל הקטעים ל-</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {(["mp3", "opus", "aac"] as OutputFormat[]).map((f) => (
                      <DropdownMenuItem key={f} onClick={() => onConvertAll(job, f)}>
                        {f.toUpperCase()}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 sm:h-7 sm:w-7"
                  title="תמלל את כל הקטעים"
                  onClick={() => onTranscribeAll(job)}
                  disabled={isTranscribingAll}
                >
                  {isTranscribingAll
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Mic className="w-3.5 h-3.5" />}
                </Button>
              </>
            )}
            {job.status === "done" && job.results.length > 1 && (
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 sm:h-7 sm:w-7"
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
                className="h-9 w-9 sm:h-7 sm:w-7"
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
                className="h-9 w-9 sm:h-7 sm:w-7"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
            )}
            {(job.status === "done" || job.status === "error") && (
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 sm:h-7 sm:w-7 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(job.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        {expanded && job.results.length > 0 && (
          <div className="space-y-1 pt-1 border-t">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/30 px-2 py-1.5" dir="rtl">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                <Checkbox
                  checked={allSegmentsSelected}
                  onCheckedChange={() => {
                    setSelectedSegments(allSegmentsSelected ? new Set() : new Set(resultIndexes));
                  }}
                  aria-label="בחר את כל הקטעים"
                />
                {allSegmentsSelected ? "בטל בחירת הכל" : "בחר הכל"}
              </label>
              <div className="flex items-center gap-2">
                {selectedSegments.size > 0 && (
                  <span className="text-xs text-muted-foreground">{selectedSegments.size} נבחרו</span>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  disabled={selectedSegments.size === 0}
                  onClick={() => openFolderDialogForResults(
                    job.results.filter((result) => selectedSegments.has(result.segmentIndex)),
                  )}
                >
                  <FolderPlus className="h-4 w-4" />
                  שמור נבחרים בתיקייה
                </Button>
              </div>
            </div>
            {job.results.map((r) => {
              const key = `${job.id}_${r.segmentIndex}`;
              const converted = convertedMap[key];
              return (
              <CutResultRow
                key={r.segmentIndex}
                result={r}
                convertedFile={converted}
                isConverting={!!segConvertingSet[key]}
                onDownload={() => {
                  const f = converted ?? r.file;
                  const url = URL.createObjectURL(f);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = f.name;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                onTranscribe={() => onTranscribeResult(converted ? { ...r, file: converted } : r)}
                onConvert={(fmt) => {
                  const baseFile = converted ?? r.file;
                  onConvertResult(job.id, r.segmentIndex, baseFile, fmt);
                }}
                onEnhance={() => onEnhanceResult(r)}
                onDelete={() => onDeleteResult(job.id, r.segmentIndex)}
                onSaveToHistory={(name, folder) => onSaveResultToHistory(r, name, folder)}
                selected={selectedSegments.has(r.segmentIndex)}
                onToggleSelected={() => {
                  setSelectedSegments((current) => {
                    const next = new Set(current);
                    if (next.has(r.segmentIndex)) next.delete(r.segmentIndex);
                    else next.add(r.segmentIndex);
                    return next;
                  });
                }}
                onSaveToFolder={() => openFolderDialogForResults([r])}
              />
              );
            })}
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
  initialPreset?: "halves" | "thirds" | "every5min";
}

export default function AdvancedCutPanel({
  initialFile,
  initialSourceLabel,
  convertedFiles = [],
  initialPreset,
}: AdvancedCutPanelProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { saveTranscript, saveLocalTranscript, updateTranscript } = useCloudTranscripts();
  const { folders, createFolder, getPath } = useFolderTree();
  const [folderJob, setFolderJob] = useState<CutJob | null>(null);
  const [folderChoice, setFolderChoice] = useState<string>("__new__");
  const [parentFolderChoice, setParentFolderChoice] = useState<string>("__root__");
  const [newFolderName, setNewFolderName] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const [folderStorageMode, setFolderStorageMode] = useState<"cloud" | "local">(
    () => localStorage.getItem("cut-folder-storage-mode") === "local" ? "local" : "cloud",
  );

  useEffect(() => {
    localStorage.setItem("cut-folder-storage-mode", folderStorageMode);
  }, [folderStorageMode]);

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
  const [isSubmittingCut, setIsSubmittingCut] = useState(false);
  const [enhanceQueueJobs, setEnhanceQueueJobs] = useState<EnhanceQueueJob[]>(() => getEnhanceQueueJobs());

  // Per-segment conversion state — key = `${jobId}_${segIndex}`
  const [convertedMap, setConvertedMap] = useState<Record<string, File>>({});
  const [segConvertingSet, setSegConvertingSet] = useState<Record<string, boolean>>({});
  const [convertingAllJobs, setConvertingAllJobs] = useState<Record<string, boolean>>({});
  const [transcribingAllJobs, setTranscribingAllJobs] = useState<Record<string, boolean>>({});

  const { submitBatchJobs } = useTranscriptionJobs();
  const { preferences } = useCloudPreferences();

  // Set initial file
  useEffect(() => {
    if (initialFile) {
      void loadSource(initialFile, initialSourceLabel || initialFile.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFile]);

  useEffect(() => {
    if (initialPreset === "halves") {
      setCutMode("count");
      setPartCount("2");
    } else if (initialPreset === "thirds") {
      setCutMode("count");
      setPartCount("3");
    } else if (initialPreset === "every5min") {
      setCutMode("time");
      setChunkMinutes("5");
      setChunkSeconds("0");
    }
  }, [initialPreset]);

  // Restore persisted jobs on mount
  useEffect(() => {
    restorePersistedCutJobs().then((restored) => {
      if (restored.length > 0) {
        setCutJobs((prev) => {
          const unique = new Map(prev.map((job) => [job.id, job]));
          restored.forEach((job) => unique.set(job.id, job));
          return Array.from(unique.values());
        });
      }
    });
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
      const duration = await probeDurationFast(file);
      if (!duration || duration <= 0) throw new Error("duration-unavailable");
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

  const handleSubmitCut = useCallback(async () => {
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
    if (isSubmittingCut) return;

    const jobId = `cut_unified_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const startedAt = Date.now();
    const initialJob: CutJob = {
      id: jobId,
      sourceFileName: sourceFile.name,
      sourceFileSize: sourceFile.size,
      sourceFile,
      config,
      status: "decoding",
      progress: 0,
      totalSegments: previewSegments.length,
      completedSegments: 0,
      results: [],
      startedAt,
      durationSec: sourceDuration ?? undefined,
    };
    setCutJobs((prev) => [initialJob, ...prev]);
    setIsSubmittingCut(true);
    toast({ title: "החיתוך התחיל", description: "המנוע יבחר אוטומטית את השיטה המהירה והבטוחה ביותר" });

    try {
      const outcome = await cutWithFallback(sourceFile, {
        config,
        knownDurationSec: sourceDuration ?? undefined,
        onProgress: (progress) => {
          const total = Math.max(1, progress.total);
          const percent = Math.min(99, Math.round((progress.completed / total) * 100));
          setCutJobs((prev) => prev.map((job) => job.id === jobId ? {
            ...job,
            status: progress.tier === "audio-buffer" && progress.completed === 0 ? "decoding" : "cutting",
            progress: percent,
            totalSegments: total,
            completedSegments: progress.completed,
            engine: progress.tier,
          } : job));
        },
      });

      const completedJob: CutJob = {
        ...initialJob,
        status: "done",
        progress: 100,
        totalSegments: outcome.results.length,
        completedSegments: outcome.results.length,
        results: outcome.results,
        durationSec: outcome.durationSec,
        finishedAt: Date.now(),
        engine: outcome.tier,
      };
      setCutJobs((prev) => prev.map((job) => job.id === jobId ? completedJob : job));

      if (outcome.sourceJobId) await removePersistedCutJob(outcome.sourceJobId);
      await persistCompletedCutJob(completedJob);

      const engineLabel: Record<CutTier, string> = {
        "wav-slice": "WAV ישיר",
        "server-ffmpeg": "FFmpeg מקומי",
        "ffmpeg-copy": "FFmpeg ללא קידוד מחדש",
        "audio-buffer": "פיענוח מלא",
      };
      toast({
        title: "חיתוך הושלם",
        description: `${outcome.results.length} קטעים נוצרו באמצעות ${engineLabel[outcome.tier]}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCutJobs((prev) => prev.map((job) => job.id === jobId ? {
        ...job,
        status: "error",
        error: message,
        finishedAt: Date.now(),
      } : job));
      toast({ title: "שגיאת חיתוך", description: message, variant: "destructive" });
    } finally {
      setIsSubmittingCut(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFile, sourceDuration, cutMode, manualRows, chunkMinutes, chunkSeconds, partCount, isSubmittingCut, previewSegments.length]);

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
        folder,
      });
    } catch {
      toast({ title: "שגיאה בשמירה", variant: "destructive" });
    }
  }, [addHistoryItem]);

  const handleSaveAllToFolder = useCallback(async () => {
    if (!folderJob || folderJob.results.length === 0) return;

    const requestedName = newFolderName.trim();
    const requestedParentId = parentFolderChoice === "__root__" ? null : parentFolderChoice;
    let targetFolder = folderChoice === "__new__"
      ? folders.find(
          (folder) =>
            folder.name.trim() === requestedName
            && (folder.parent_id || null) === requestedParentId,
        )
      : folders.find((folder) => folder.id === folderChoice);

    if (folderChoice === "__new__" && !requestedName) {
      toast({ title: "יש להזין שם לתיקייה", variant: "destructive" });
      return;
    }

    setSavingFolder(true);
    try {
      if (!targetFolder) {
        targetFolder = await createFolder({
          name: requestedName,
          parent_id: requestedParentId,
          emoji: "🎧",
        });
      }

      const orderedResults = [...folderJob.results].sort((a, b) => a.segmentIndex - b.segmentIndex);
      const digits = Math.max(2, String(orderedResults.length).length);
      const safeFolderName = targetFolder.name.replace(/[/\\:*?"<>|]/g, "_").trim() || "קטעים";

      for (let index = 0; index < orderedResults.length; index += 1) {
        const result = orderedResults[index];
        const extension = result.file.name.match(/(\.[^.]+)$/)?.[1] || ".wav";
        const number = String(index + 1).padStart(digits, "0");
        const numberedName = `${safeFolderName}_${number}${extension}`;
        const numberedFile = new File([result.file], numberedName, {
          type: result.file.type,
          lastModified: result.file.lastModified,
        });

        if (folderStorageMode === "cloud") {
          const transcript = await saveTranscript(
            "",
            "audio-cut",
            numberedName.replace(/\.[^.]+$/, ""),
            numberedFile,
            null,
            targetFolder.name,
            { waitForAudioUpload: true },
          );

          if (!transcript?.audio_file_path) {
            throw new Error(`הקטע ${numberedName} לא נשמר בענן`);
          }

          await updateTranscript(transcript.id, {
            folder: targetFolder.name,
            folder_id: targetFolder.id,
          });
        } else {
          const transcript = await saveLocalTranscript({
            title: numberedName.replace(/\.[^.]+$/, ""),
            audioFile: numberedFile,
            folder: targetFolder.name,
            folderId: targetFolder.id,
          });
          if (!transcript) {
            throw new Error(`הקטע ${numberedName} לא נשמר במחשב`);
          }
        }

        await addHistoryItem({
          file_name: numberedName,
          original_name: result.file.name,
          output_format: extension.slice(1).toLowerCase() || "wav",
          file_size: result.sizeBytes,
          output_size: result.sizeBytes,
          duration_ms: Math.round(result.durationSec * 1000),
          folder: targetFolder.name,
        });
      }

      toast({
        title: "הקטעים נשמרו בתיקייה",
        description: `${orderedResults.length} קטעים נשמרו ב־${targetFolder.name} ${
          folderStorageMode === "cloud" ? "במחשב ובענן" : "במחשב בלבד"
        }`,
      });
      setFolderJob(null);
      setFolderChoice("__new__");
      setParentFolderChoice("__root__");
      setNewFolderName("");
    } catch (error) {
      toast({
        title: "שמירת הקטעים נכשלה",
        description: error instanceof Error ? error.message : "נסה שוב",
        variant: "destructive",
      });
    } finally {
      setSavingFolder(false);
    }
  }, [
    addHistoryItem,
    createFolder,
    folderChoice,
    folderJob,
    folderStorageMode,
    folders,
    newFolderName,
    parentFolderChoice,
    saveTranscript,
    saveLocalTranscript,
    updateTranscript,
  ]);

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

  const sendFilesToTranscribeQueue = useCallback(async (files: File[]) => {
    const engine = (preferences as { engine?: string }).engine || "groq";
    const lang = (preferences as { source_language?: string }).source_language || "he";
    const onlineEngine = (engine === "local" || engine === "local-server") ? "groq" : engine;
    const ids = await submitBatchJobs(files, onlineEngine, lang);
    toast({
      title: "נשלח לתור התמלול",
      description: `${ids.length} מקטעים בתור (מנוע: ${onlineEngine})`,
    });
  }, [preferences, submitBatchJobs]);

  const handleConvertResult = useCallback(
    async (jobId: string, segIndex: number, baseFile: File, fmt: OutputFormat) => {
      const key = `${jobId}_${segIndex}`;
      setSegConvertingSet((s) => ({ ...s, [key]: true }));
      try {
        const out = await convertOne(baseFile, fmt);
        setConvertedMap((m) => ({ ...m, [key]: out }));
        toast({ title: "✅ הומר", description: out.name });
      } catch (e) {
        toast({
          title: "שגיאת המרה",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      } finally {
        setSegConvertingSet((s) => { const n = { ...s }; delete n[key]; return n; });
      }
    },
    [],
  );

  const handleConvertAllForJob = useCallback(
    async (job: CutJob, fmt: OutputFormat) => {
      setConvertingAllJobs((s) => ({ ...s, [job.id]: true }));
      let done = 0;
      try {
        for (const r of job.results) {
          const key = `${job.id}_${r.segmentIndex}`;
          setSegConvertingSet((s) => ({ ...s, [key]: true }));
          try {
            const out = await convertOne(r.file, fmt);
            setConvertedMap((m) => ({ ...m, [key]: out }));
            done++;
          } finally {
            setSegConvertingSet((s) => { const n = { ...s }; delete n[key]; return n; });
          }
        }
        toast({
          title: "✅ המרה הושלמה",
          description: `${done}/${job.results.length} מקטעים ל-${fmt.toUpperCase()}`,
        });
      } catch (e) {
        toast({
          title: "שגיאת המרה",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      } finally {
        setConvertingAllJobs((s) => { const n = { ...s }; delete n[job.id]; return n; });
      }
    },
    [],
  );

  const handleTranscribeAllForJob = useCallback(
    async (job: CutJob) => {
      setTranscribingAllJobs((s) => ({ ...s, [job.id]: true }));
      try {
        const files = job.results.map((r) => convertedMap[`${job.id}_${r.segmentIndex}`] ?? r.file);
        await sendFilesToTranscribeQueue(files);
      } catch (e) {
        toast({
          title: "שגיאת שליחה לתמלול",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      } finally {
        setTranscribingAllJobs((s) => { const n = { ...s }; delete n[job.id]; return n; });
      }
    },
    [convertedMap, sendFilesToTranscribeQueue],
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
    <div className="space-y-4" dir="rtl">
      {/* Source selection */}
      <Card className="border-primary/15 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-l from-primary/5 to-transparent">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="rounded-lg bg-primary/10 p-1.5">
              <Scissors className="w-4 h-4 text-primary" />
            </span>
            מערכת חיתוך מתקדמת
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File source */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9 sm:h-9"
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
            <div className="flex items-center gap-2 text-sm bg-primary/5 border border-primary/15 rounded-xl px-3 py-2.5">
              <FileAudio className="w-4 h-4 text-primary shrink-0" />
              <span className="font-medium truncate">{sourceLabel}</span>
              {isProbing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {sourceDuration !== null && (
                <Badge variant="secondary" className="text-[10px] shrink-0">
                  {formatTime(sourceDuration)}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground mr-auto shrink-0">{formatBytes(sourceFile.size)}</span>
            </div>
          )}

          {sourceFile && sourceDuration !== null && (
            <>
              {/* Quick actions */}
              <div className="flex flex-wrap gap-1.5 items-center">
                <span className="text-xs font-medium text-muted-foreground self-center">חלוקה מהירה:</span>
                {[2, 3, 4, 5, 10].map((n) => (
                  <Button
                    key={n}
                    variant={cutMode === "count" && partCount === String(n) ? "default" : "outline"}
                    size="sm"
                    className="h-9 sm:h-7 text-xs px-3 sm:px-2.5 rounded-full"
                    onClick={() => quickSplitEqual(n)}
                  >
                    {n} חלקים
                  </Button>
                ))}
                <span className="text-muted-foreground/40 self-center mx-1">|</span>
                {[1, 3, 5, 10, 15, 30].map((m) => (
                  <Button
                    key={m}
                    variant={cutMode === "time" && chunkMinutes === String(m) && chunkSeconds === "0" ? "default" : "outline"}
                    size="sm"
                    className="h-9 sm:h-7 text-xs px-3 sm:px-2.5 rounded-full"
                    onClick={() => quickSplitByMinutes(m)}
                  >
                    כל {m} דק׳
                  </Button>
                ))}
              </div>

              {/* Mode Tabs */}
              <div className="flex gap-1 border rounded-xl p-1 bg-muted/30">
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
                      "flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 sm:py-2 rounded-lg text-xs font-medium transition-all",
                      cutMode === mode
                        ? "bg-background shadow-sm text-primary ring-1 ring-primary/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/50",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Mode-specific config */}
              <div className="border rounded-xl p-3 sm:p-4 space-y-3 bg-muted/10">
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
                              className="h-9 sm:h-7 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <Input
                              placeholder={sourceDuration ? formatTime(sourceDuration) : "סוף"}
                              value={row.endInput}
                              onChange={(e) => updateManualRow(row.id, "endInput", e.target.value)}
                              className="h-9 sm:h-7 text-xs font-mono"
                            />
                          </div>
                          <div>
                            <Input
                              placeholder={`חלק ${i + 1}`}
                              value={row.label}
                              onChange={(e) => updateManualRow(row.id, "label", e.target.value)}
                              className="h-9 sm:h-7 text-xs"
                            />
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 sm:h-7 sm:w-7 text-muted-foreground hover:text-destructive shrink-0"
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
                          className="h-10 sm:h-8"
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
                          className="h-10 sm:h-8"
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
                        className="h-10 sm:h-8 w-20"
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
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button
                  className="gap-2 h-11 sm:h-10 w-full sm:w-auto shadow-sm"
                  disabled={!sourceFile || previewSegments.length === 0 || isSubmittingCut}
                  onClick={() => void handleSubmitCut()}
                >
                  {isSubmittingCut
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Scissors className="w-4 h-4" />}
                  {isSubmittingCut ? "חותך במנוע המדורג..." : `חתוך ${previewSegments.length} קטעים`}
                </Button>
                {previewSegments.length > 0 && (
                  <span className="text-xs text-muted-foreground text-center sm:text-right">
                    WAV ישיר → FFmpeg מקומי → FFmpeg בדפדפן → פיענוח מלא כגיבוי
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Jobs list */}
      {cutJobs.length > 0 && (
        <Card className="border-primary/15 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileAudio className="w-4 h-4 text-primary" />
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
                    convertedMap={convertedMap}
                    segConvertingSet={segConvertingSet}
                    isTranscribingAll={!!transcribingAllJobs[job.id]}
                    isConvertingAll={!!convertingAllJobs[job.id]}
                    onRemove={handleRemoveJob}
                    onDownloadAll={handleDownloadAll}
                    onConvertAll={handleConvertAllForJob}
                    onTranscribeAll={handleTranscribeAllForJob}
                    onConvertResult={handleConvertResult}
                    onEnhanceAll={handleEnhanceAllResults}
                    onTranscribeResult={handleTranscribeResult}
                    onEnhanceResult={setEnhanceTarget}
                    onDeleteResult={handleDeleteResult}
                    onSaveResultToHistory={handleSaveResultToHistory}
                    onSaveAllToFolder={setFolderJob}
                  />
                ))}
              </div>
          </CardContent>
        </Card>
      )}

{/* enhance queue panel removed per user request */}

      <Dialog
        open={folderJob !== null}
        onOpenChange={(open) => {
          if (!open && !savingFolder) {
            setFolderJob(null);
            setFolderChoice("__new__");
            setParentFolderChoice("__root__");
            setNewFolderName("");
          }
        }}
      >
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-primary" />
              שמירת כל הקטעים בתיקייה
            </DialogTitle>
            <DialogDescription>
              הקטעים יישמרו כאודיו בענן, ימוספרו לפי הסדר ויופיעו במנהל התיקיות.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="font-medium">{folderJob?.results.length || 0} קטעים</span>
              <span className="text-muted-foreground"> מתוך {folderJob?.sourceFileName}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={folderChoice === "__new__" ? "default" : "outline"}
                onClick={() => setFolderChoice("__new__")}
                disabled={savingFolder}
                className="gap-2"
              >
                <FolderPlus className="h-4 w-4" />
                צור תיקייה חדשה
              </Button>
              <Button
                type="button"
                variant={folderChoice !== "__new__" ? "default" : "outline"}
                onClick={() => {
                  const selectedExists = folders.some((folder) => folder.id === parentFolderChoice);
                  setFolderChoice(selectedExists ? parentFolderChoice : (folders[0]?.id || "__new__"));
                }}
                disabled={savingFolder || folders.length === 0}
                className="gap-2"
              >
                <FolderOpen className="h-4 w-4" />
                תיקייה קיימת
              </Button>
            </div>

            {folderChoice === "__new__" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>בחר היכן ליצור את התיקייה החדשה</Label>
                  <FolderDestinationTree
                    folders={folders}
                    selectedId={parentFolderChoice}
                    includeRoot
                    disabled={savingFolder}
                    onSelect={setParentFolderChoice}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cut-folder-name">שם תיקיית הקטעים</Label>
                  <Input
                    id="cut-folder-name"
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    placeholder="לדוגמה: פרשת וירא"
                    disabled={savingFolder}
                    autoFocus
                  />
                </div>

                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  הנתיב שייווצר:{" "}
                  <span className="font-medium">
                    {parentFolderChoice === "__root__"
                      ? newFolderName.trim() || "שם התיקייה"
                      : `${getPath(parentFolderChoice).map((item) => item.name).join(" / ")} / ${newFolderName.trim() || "שם התיקייה"}`}
                  </span>
                </div>
              </div>
            )}

            {folderChoice !== "__new__" && (
              <div className="space-y-2">
                <Label>בחר תיקיית יעד קיימת</Label>
                <FolderDestinationTree
                  folders={folders}
                  selectedId={folderChoice}
                  includeRoot={false}
                  disabled={savingFolder}
                  onSelect={setFolderChoice}
                />
                <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  הקטעים יישמרו בתוך:{" "}
                  <span className="font-medium">
                    {getPath(folderChoice).map((item) => item.name).join(" / ")}
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>מיקום שמירת הקטעים</Label>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="מיקום שמירת הקטעים">
                <Button
                  type="button"
                  variant={folderStorageMode === "cloud" ? "default" : "outline"}
                  onClick={() => setFolderStorageMode("cloud")}
                  disabled={savingFolder}
                  className="h-auto min-h-12 gap-2 py-2"
                  role="radio"
                  aria-checked={folderStorageMode === "cloud"}
                  title="שמור עותק מקומי והעלה גם לענן"
                >
                  <Cloud className="h-4 w-4" />
                  מקומי וגם בענן
                </Button>
                <Button
                  type="button"
                  variant={folderStorageMode === "local" ? "default" : "outline"}
                  onClick={() => setFolderStorageMode("local")}
                  disabled={savingFolder}
                  className="h-auto min-h-12 gap-2 py-2"
                  role="radio"
                  aria-checked={folderStorageMode === "local"}
                  title="שמור במאגר המקומי של המכשיר ללא העלאה לענן"
                >
                  <HardDrive className="h-4 w-4" />
                  במחשב בלבד
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                הבחירה האחרונה נשמרת כברירת המחדל לפעם הבאה.
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              שמות הקבצים יהיו בפורמט: שם_התיקייה_01, שם_התיקייה_02 וכן הלאה.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              onClick={handleSaveAllToFolder}
              disabled={
                savingFolder
                || !folderJob
                || (folderChoice === "__new__" && !newFolderName.trim())
              }
              className="gap-2"
            >
              {savingFolder
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Save className="h-4 w-4" />}
              שמור {folderJob?.results.length || 0} קטעים
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setFolderJob(null);
                setParentFolderChoice("__root__");
              }}
              disabled={savingFolder}
            >
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
