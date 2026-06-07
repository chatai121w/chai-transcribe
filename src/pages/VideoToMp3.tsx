import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import {
  convertAudio,
  extractAudio,
  retryJob,
  onJobUpdate,
  revokeJobUrl,
  preloadFFmpeg,
  isSupportedFormat,
  getSupportedExtensions,
  getMaxParallel,
  restorePersistedJobs,
  removePersistedJob,
  type ConversionJob,
  type OutputFormat,
} from "@/lib/ffmpegConverter";

import {
  clearEnhanceQueueCompleted,
  getEnhanceQueueJobs,
  onEnhanceQueueUpdate,
  removeEnhanceQueueJob,
  submitEnhanceJob,
  type EnhanceQueueJob,
} from "@/lib/audioEnhanceQueue";
import { isServerAvailable } from "@/lib/conversionRouter";
import { useConversionHistory, type ConversionHistoryItem } from "@/hooks/useConversionHistory";
import { CompletedFilesPanel } from "@/components/CompletedFilesPanel";
import { pushCompletedFile } from "@/lib/completedFilesBus";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  Upload,
  FileAudio,
  Download,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Music,
  FolderDown,
  Zap,
  Mic,
  Save,
  RefreshCw,
  Cpu,
  Scissors,
  Server,
  Globe,
  Sparkles,
  Pencil,
  FolderOpen,
  History,
  Check,
  ListChecks,
  X,
  Minus,
  Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AudioEnhanceDialog from "@/components/AudioEnhanceDialog";

// Lazy-loaded advanced cut panel
const AdvancedCutPanel = lazy(() => import("@/components/AdvancedCutPanel"));

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

const ACCEPTED_MIME =
  "video/*,audio/*,.mkv,.avi,.mov,.webm,.flv,.wmv,.m4v,.3gp,.ogv,.ts,.mts,.m2ts,.vob,.mpg,.mpeg,.m4a,.wav,.ogg,.flac,.aac,.wma,.opus,.amr";

const OUTPUT_FORMAT_META: Record<OutputFormat, { label: string; ext: string; mime: string; description: string }> = {
  mp3: {
    label: "MP3",
    ext: "mp3",
    mime: "audio/mpeg",
    description: "תאימות מקסימלית",
  },
  opus: {
    label: "OPUS",
    ext: "opus",
    mime: "audio/opus",
    description: "איכות גבוהה בקובץ קטן",
  },
  aac: {
    label: "AAC",
    ext: "m4a",
    mime: "audio/mp4",
    description: "מעולה למובייל וסטרימינג",
  },
};

function getOutputFileName(fileName: string, outputFormat: OutputFormat): string {
  const ext = OUTPUT_FORMAT_META[outputFormat].ext;
  return fileName.replace(/\.[^/.]+$/, "") + `.${ext}`;
}

/** Job-aware output name — honors `outputExt` (set by audio extraction). */
function getJobOutputName(job: ConversionJob): string {
  if (job.outputExt) return job.fileName.replace(/\.[^/.]+$/, "") + `.${job.outputExt}`;
  return getOutputFileName(job.fileName, job.outputFormat);
}

function getJobOutputMime(job: ConversionJob): string {
  return job.outputMime ?? OUTPUT_FORMAT_META[job.outputFormat].mime;
}


// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ConversionJob["status"] }) {
  const config: Record<ConversionJob["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ElementType }> = {
    queued: { label: "בתור", variant: "secondary", icon: Clock },
    loading: { label: "טוען FFmpeg", variant: "outline", icon: Loader2 },
    converting: { label: "ממיר...", variant: "default", icon: Zap },
    done: { label: "הושלם", variant: "secondary", icon: CheckCircle2 },
    error: { label: "שגיאה", variant: "destructive", icon: XCircle },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <Badge variant={c.variant} className="gap-1 text-xs">
      <Icon className={cn("w-3 h-3", (status === "loading" || status === "converting") && "animate-spin")} />
      {c.label}
    </Badge>
  );
}

// ─── Job Card ────────────────────────────────────────────────────────────────

function JobCard({
  job,
  onRemove,
  onTranscribe,
  onSaveAndTranscribe,
  onRetry,
  onCut,
  onEnhance,
}: {
  job: ConversionJob;
  onRemove: (id: string) => void;
  onTranscribe: (job: ConversionJob) => void;
  onSaveAndTranscribe: (job: ConversionJob) => void;
  onRetry: (job: ConversionJob) => void;
  onCut: (job: ConversionJob) => void;
  onEnhance: (job: ConversionJob) => void;
}) {
  const elapsed =
    job.startedAt && job.finishedAt
      ? formatDuration(job.finishedAt - job.startedAt)
      : job.startedAt
        ? formatDuration(Date.now() - job.startedAt)
        : null;

  const outputFilename = getJobOutputName(job);

  return (
    <Card className="relative overflow-hidden" data-testid="job-card" data-status={job.status}>
      {(job.status === "converting" || job.status === "loading") && (
        <div
          className="absolute bottom-0 left-0 h-1 bg-primary/60 transition-all duration-300"
          style={{ width: `${job.progress}%` }}
        />
      )}
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3" dir="rtl">
          {/* Info */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="rounded-lg bg-primary/10 p-2 shrink-0">
              {job.status === "done" ? (
                <Music className="w-5 h-5 text-green-500" />
              ) : (
                <FileAudio className="w-5 h-5 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate text-sm">{job.fileName}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                <span>{formatBytes(job.fileSize)}</span>
                {job.outputBlob && (
                  <>
                    <span>→</span>
                    <span className="text-green-600">{formatBytes(job.outputBlob.size)}</span>
                  </>
                )}
                {elapsed && <span>• {elapsed}</span>}
                {job.retryCount > 0 && <span>• ניסיון {job.retryCount + 1}</span>}
                {job.conversionPath && (
                  <span className="inline-flex items-center gap-0.5">
                    •
                    {job.conversionPath === "server" ? (
                      <><Server className="w-3 h-3" /> שרת</>
                    ) : (
                      <><Globe className="w-3 h-3" /> דפדפן</>
                    )}
                  </span>
                )}
              </div>
              {(job.status === "converting" || job.status === "loading") && (
                <div className="flex items-center gap-2 mt-2">
                  <Progress value={job.progress} className="h-2 flex-1" />
                  <span className="text-xs font-mono text-muted-foreground w-9 text-left">{job.progress}%</span>
                </div>
              )}
              {job.error && (
                <p className="text-xs text-destructive mt-1">{job.error}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-wrap justify-end w-full sm:w-auto sm:shrink-0">
            <StatusBadge status={job.status} />
            {job.status === "done" && job.outputUrl && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 text-green-600 hover:text-green-700"
                  title="שמור + תמלל + ענן"
                  onClick={() => onSaveAndTranscribe(job)}
                >
                  <Save className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 text-primary hover:text-primary"
                  title="תמלול"
                  onClick={() => onTranscribe(job)}
                >
                  <Mic className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  title="חתוך קובץ"
                  onClick={() => onCut(job)}
                >
                  <Scissors className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  title="שיפור איכות"
                  onClick={() => onEnhance(job)}
                >
                  <Sparkles className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-9 w-9" asChild>
                  <a href={job.outputUrl} download={outputFilename}>
                    <Download className="w-4 h-4" />
                  </a>
                </Button>
              </>
            )}
            {job.status === "error" && onRetry && (
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 text-orange-500 hover:text-orange-600"
                title="נסה שוב"
                onClick={() => onRetry(job)}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            )}
            {(job.status === "done" || job.status === "error") && (
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 text-muted-foreground hover:text-destructive"
                onClick={() => onRemove(job.id)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function VideoToMp3() {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const isMobile = useIsMobile();
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(() => {
    const saved = localStorage.getItem("video_to_audio_output_format");
    if (saved === "mp3" || saved === "opus" || saved === "aac") return saved;
    return "mp3";
  });
  const [isDragging, setIsDragging] = useState(false);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [promptJob, setPromptJob] = useState<ConversionJob | null>(null);
  const [promptMinimized, setPromptMinimized] = useState(false);
  const [enhanceTarget, setEnhanceTarget] = useState<ConversionJob | null>(null);
  const [enhanceQueueJobs, setEnhanceQueueJobs] = useState<EnhanceQueueJob[]>(() => getEnhanceQueueJobs());
  const [saveAndTranscribeBusyId, setSaveAndTranscribeBusyId] = useState<string | null>(null);
  const [autoTranscribe, setAutoTranscribe] = useState(false);
  const [activeTab, setActiveTab] = useState<"convert" | "extract" | "cut">("convert");
  const [cutInitialFile, setCutInitialFile] = useState<File | null>(null);
  const [cutInitialLabel, setCutInitialLabel] = useState("");
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Conversion history (persistent, cloud-synced)
  const history = useConversionHistory();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editingOriginalId, setEditingOriginalId] = useState<string | null>(null);
  const [editOriginalName, setEditOriginalName] = useState("");
  const [folderEditId, setFolderEditId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(new Set());
  const savedJobIdsRef = useRef<Set<string>>(new Set());

  const toOutputFile = useCallback((job: ConversionJob): File | null => {
    if (!job.outputBlob) return null;
    const outputName = getJobOutputName(job);
    return new File([job.outputBlob], outputName, { type: getJobOutputMime(job) });
  }, []);


  const uploadMp3ToCloud = useCallback(async (file: File): Promise<string | null> => {
    if (!isAuthenticated || !user) return null;
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${user.id}/${Date.now()}_${safeName}`;

    const { error } = await supabase.storage
      .from("permanent-audio")
      .upload(filePath, file, { cacheControl: "3600", upsert: false });

    if (error) throw error;
    return filePath;
  }, [isAuthenticated, user]);

  // Download a history item's converted file (from cloud storage if available, otherwise from active job's local blob)
  const handleDownloadHistoryItem = useCallback(async (item: ConversionHistoryItem) => {
    try {
      // Try cloud storage first
      if (item.file_path) {
        const { data, error } = await supabase.storage
          .from("permanent-audio")
          .download(item.file_path);
        if (error) throw error;
        const url = URL.createObjectURL(data);
        const a = document.createElement("a");
        a.href = url;
        a.download = item.file_name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        return;
      }
      // Fallback: search active jobs for matching output blob
      const matchingJob = jobs.find((j) =>
        j.status === "done" &&
        j.outputUrl &&
        getOutputFileName(j.fileName, j.outputFormat) === item.file_name
      );
      if (matchingJob?.outputUrl) {
        const a = document.createElement("a");
        a.href = matchingJob.outputUrl;
        a.download = item.file_name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      toast({
        title: "הקובץ אינו זמין להורדה",
        description: "קובץ ההמרה לא נשמר בענן. השתמש בכפתור 'שמור + תמלל + ענן' כדי לשמור את הקובץ.",
        variant: "destructive",
      });
    } catch (err) {
      toast({
        title: "שגיאה בהורדה",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [jobs]);

  const toggleSelectHistory = useCallback((id: string) => {
    setSelectedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAllHistory = useCallback(() => {
    setSelectedHistoryIds((prev) => {
      if (prev.size === history.items.length) return new Set();
      return new Set(history.items.map((it) => it.id));
    });
  }, [history.items]);

  const handleDeleteSelectedHistory = useCallback(async () => {
    const ids = Array.from(selectedHistoryIds);
    if (ids.length === 0) return;
    if (!confirm(`למחוק ${ids.length} פריטים מההיסטוריה?`)) return;
    try {
      await history.removeMany(ids);
      setSelectedHistoryIds(new Set());
      toast({ title: `${ids.length} פריטים נמחקו` });
    } catch (err) {
      toast({
        title: "שגיאה במחיקה",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }, [selectedHistoryIds, history]);


  // Preload FFmpeg on mount + restore persisted jobs + check server
  useEffect(() => {
    localStorage.setItem("video_to_audio_output_format", outputFormat);
  }, [outputFormat]);

  useEffect(() => {
    preloadFFmpeg()
      .then(() => setFfmpegReady(true))
      .catch(() => {
        // Will load on first conversion
      });

    isServerAvailable().then(setServerOnline);

    // Restore any persisted jobs from previous session
    restorePersistedJobs().then((restored) => {
      if (restored.length > 0) {
        setJobs((prev) => [...prev, ...restored]);
        toast({ title: `${restored.length} המרות שוחזרו מהפעלה קודמת` });
      }
    });
  }, []);

  // Listen to job updates + auto-show prompt on completion + auto-save to history
  useEffect(() => {
    const unsub = onJobUpdate((updatedJob) => {
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === updatedJob.id);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = updatedJob;
        return next;
      });

      if (updatedJob.status === "done") {
        // Auto-save to conversion history (once per job)
        if (!savedJobIdsRef.current.has(updatedJob.id) && isAuthenticated) {
          savedJobIdsRef.current.add(updatedJob.id);
          const outputName = getJobOutputName(updatedJob);
          history.addItem({
            file_name: outputName,
            original_name: updatedJob.fileName,
            output_format: (updatedJob.outputExt as OutputFormat) ?? updatedJob.outputFormat,

            file_size: updatedJob.fileSize,
            output_size: updatedJob.outputBlob?.size || 0,
            duration_ms: updatedJob.finishedAt && updatedJob.startedAt
              ? updatedJob.finishedAt - updatedJob.startedAt
              : 0,
          }).catch(() => {});
        }

        if (autoTranscribe) {
          const outputFile = toOutputFile(updatedJob);
          if (outputFile) {
            navigate("/transcribe", { state: { file: outputFile } });
            return;
          }
        }
        const outFile = toOutputFile(updatedJob);
        if (outFile) {
          pushCompletedFile(outFile, "convert", updatedJob.fileName);
        }
        setPromptJob(updatedJob);
      }
    });
    return unsub;
  }, [autoTranscribe, toOutputFile, navigate, isAuthenticated, history]);

  useEffect(() => {
    return onEnhanceQueueUpdate((nextJobs) => {
      setEnhanceQueueJobs(nextJobs);
    });
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      jobs.forEach(revokeJobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const valid: File[] = [];
    const invalid: string[] = [];

    for (const f of fileArray) {
      if (isSupportedFormat(f.name)) {
        valid.push(f);
      } else {
        invalid.push(f.name);
      }
    }

    if (invalid.length > 0) {
      toast({
        title: "פורמט לא נתמך",
        description: invalid.join(", "),
        variant: "destructive",
      });
    }

    if (valid.length === 0) return;

    const newJobs = valid.map((f) => convertAudio(f, outputFormat));
    setJobs((prev) => [...newJobs, ...prev]);
  }, [outputFormat]);

  const handleRemove = useCallback((id: string) => {
    setJobs((prev) => {
      const job = prev.find((j) => j.id === id);
      if (job) revokeJobUrl(job);
      return prev.filter((j) => j.id !== id);
    });
    removePersistedJob(id);
  }, []);

  const handleDownloadAll = useCallback(() => {
    const doneJobs = jobs.filter((j) => j.status === "done" && j.outputUrl);
    for (const job of doneJobs) {
      const a = document.createElement("a");
      a.href = job.outputUrl!;
      a.download = getJobOutputName(job);

      a.click();
    }
  }, [jobs]);

  const handleClearDone = useCallback(() => {
    setJobs((prev) => {
      const toRemove = prev.filter((j) => j.status === "done" || j.status === "error");
      toRemove.forEach((j) => {
        revokeJobUrl(j);
        removePersistedJob(j.id);
      });
      return prev.filter((j) => j.status !== "done" && j.status !== "error");
    });
  }, []);

  const handleEnhanceAllConverted = useCallback(() => {
    const convertible = jobs.filter((j) => j.status === "done");
    let queued = 0;
    for (const job of convertible) {
      const outputFile = toOutputFile(job);
      if (!outputFile) continue;
      submitEnhanceJob(outputFile, {
        preset: "ai_voice",
        outputFormat: job.outputFormat,
      });
      queued += 1;
    }

    if (queued === 0) {
      toast({
        title: "אין קבצים זמינים לשיפור",
        description: "יש להשלים המרה לפני הוספה לתור שיפור",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "שיפור אצווה התחיל",
      description: `${queued} קבצים נכנסו לתור שיפור רקע`,
    });
  }, [jobs, toOutputFile]);

  const handleDownloadEnhancedQueueJob = useCallback((job: EnhanceQueueJob) => {
    if (!job.outputFile) return;
    const url = URL.createObjectURL(job.outputFile);
    const a = document.createElement("a");
    a.href = url;
    a.download = job.outputFile.name;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleTranscribeEnhancedQueueJob = useCallback((job: EnhanceQueueJob) => {
    if (!job.outputFile) return;
    navigate("/transcribe", { state: { file: job.outputFile } });
  }, [navigate]);

  // Navigate to transcription page with the converted MP3
  const handleTranscribe = useCallback((job: ConversionJob) => {
    const outputFile = toOutputFile(job);
    console.log('[VideoToMp3] handleTranscribe', {
      jobId: job.id,
      hasOutputFile: !!outputFile,
      isFile: outputFile instanceof File,
      name: outputFile?.name,
      size: outputFile?.size,
      type: outputFile?.type,
    });
    if (!outputFile) {
      toast({ title: "❌ אין קובץ פלט", description: "ההמרה לא הסתיימה כראוי", variant: "destructive" });
      return;
    }
    navigate("/transcribe", { state: { file: outputFile } });
  }, [navigate, toOutputFile]);

  // Download the MP3 file
  const handleSaveMp3 = useCallback((job: ConversionJob) => {
    if (!job.outputUrl) return;
    const a = document.createElement("a");
    a.href = job.outputUrl;
    a.download = getJobOutputName(job);
    a.click();
    setPromptJob(null);
    toast({ title: "הקובץ נשמר ✓" });
  }, []);

  const handleSaveAndTranscribe = useCallback(async (job: ConversionJob) => {
    const outputFile = toOutputFile(job);
    if (!outputFile || !job.outputUrl) return;

    setSaveAndTranscribeBusyId(job.id);
    try {
      // Keep an explicit local copy for the user before moving to transcription.
      const a = document.createElement("a");
      a.href = job.outputUrl;
      a.download = outputFile.name;
      a.click();

      if (isAuthenticated) {
        try {
          await uploadMp3ToCloud(outputFile);
          toast({ title: "הקובץ נשמר והועלה לענן ✓" });
        } catch {
          toast({
            title: "התמלול ימשיך, אבל העלאה לענן נכשלה",
            description: "ניתן לנסות להעלות שוב מתוך מסך התמלול",
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "הקובץ נשמר מקומית",
          description: "כדי להעלות גם לענן יש להתחבר לחשבון",
        });
      }

      navigate("/transcribe", { state: { file: outputFile } });
      setPromptJob(null);
    } finally {
      setSaveAndTranscribeBusyId(null);
    }
  }, [isAuthenticated, navigate, toOutputFile, uploadMp3ToCloud]);

  // Retry a failed conversion
  const handleRetry = useCallback((job: ConversionJob) => {
    if (!job.file) {
      toast({ title: "לא ניתן לנסות שוב — הקובץ המקורי לא זמין", variant: "destructive" });
      return;
    }
    const updatedJob = retryJob(job, job.file);
    setJobs((prev) => prev.map((j) => (j.id === updatedJob.id ? updatedJob : j)));
  }, []);

  const handleSelectCutSource = useCallback(async (file: File, sourceName?: string) => {
    setCutInitialFile(file);
    setCutInitialLabel(sourceName || file.name);
  }, []);

  const handleCutFromConverted = useCallback((job: ConversionJob) => {
    const outputFile = toOutputFile(job);
    if (!outputFile) return;
    void handleSelectCutSource(outputFile, `${job.fileName} (מומר)`);
    setActiveTab("cut");
  }, [handleSelectCutSource, toOutputFile]);

  // Drag & Drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles]
  );

  const stats = {
    total: jobs.length,
    done: jobs.filter((j) => j.status === "done").length,
    active: jobs.filter((j) => j.status === "converting" || j.status === "loading").length,
    queued: jobs.filter((j) => j.status === "queued").length,
    errors: jobs.filter((j) => j.status === "error").length,
  };
  const doneJobs = jobs.filter((j) => j.status === "done" && !!j.outputBlob);
  const enhanceQueueStats = {
    total: enhanceQueueJobs.length,
    active: enhanceQueueJobs.filter((j) => j.status === "enhancing").length,
    queued: enhanceQueueJobs.filter((j) => j.status === "queued").length,
    done: enhanceQueueJobs.filter((j) => j.status === "done").length,
    errors: enhanceQueueJobs.filter((j) => j.status === "error").length,
  };

  return (
    <div className="container w-full max-w-4xl mx-auto py-4 sm:py-6 px-3 sm:px-4 space-y-4 sm:space-y-6 overflow-x-hidden" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2">
            <Music className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            ממיר וידאו ואודיו
          </h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">
            המרה היברידית ל-MP3 / OPUS / AAC — דפדפן לקבצים קטנים, שרת לקבצים גדולים.
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="gap-1 text-[10px] sm:text-xs">
            <Cpu className="w-3 h-3" />
            {getMaxParallel()} מקבילים
          </Badge>
          <Badge variant={ffmpegReady ? "secondary" : "outline"} className="gap-1 text-[10px] sm:text-xs">
            {ffmpegReady ? (
              <><CheckCircle2 className="w-3 h-3 text-green-500" /> מוכן</>
            ) : (
              <><Loader2 className="w-3 h-3 animate-spin" /> טוען...</>
            )}
          </Badge>
          {serverOnline !== null && (
            <Badge variant={serverOnline ? "secondary" : "outline"} className="gap-1 text-[10px] sm:text-xs">
              <Server className="w-3 h-3" />
              {serverOnline ? "שרת" : "ללא שרת"}
            </Badge>
          )}
        </div>
      </div>


      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "convert" | "cut")} className="space-y-4" dir="rtl">
        <TabsList className="grid w-full grid-cols-2 max-w-full sm:max-w-[360px] h-11 sm:h-10">
          <TabsTrigger value="convert" className="gap-1.5">
            <Music className="w-4 h-4" />
            המרה
          </TabsTrigger>
          <TabsTrigger value="cut" className="gap-1.5">
            <Scissors className="w-4 h-4" />
            חיתוך קבצים
          </TabsTrigger>
        </TabsList>

        <TabsContent value="convert" className="space-y-6">
          {/* Auto-transcribe toggle */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={autoTranscribe}
                onChange={(e) => setAutoTranscribe(e.target.checked)}
                className="rounded border-muted-foreground/40"
              />
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              המר ותמלל אוטומטית — בסיום ההמרה עובר ישירות לתמלול
            </label>
          </div>

          {/* Output format selector */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">פורמט פלט</p>
                  <p className="text-xs text-muted-foreground">הבחירה תשפיע על כל ההמרות החדשות. מנוע FFmpeg נטען עצלית ועובד ברקע כמו המערכת הקיימת.</p>
                </div>
                <div className="flex w-full sm:w-auto gap-2">
                  {(["mp3", "opus", "aac"] as OutputFormat[]).map((fmt) => (
                    <Button
                      key={fmt}
                      size="sm"
                      variant={outputFormat === fmt ? "default" : "outline"}
                      onClick={() => setOutputFormat(fmt)}
                      className="flex-1 sm:flex-none h-11 sm:h-9 sm:min-w-[96px]"
                    >
                      {OUTPUT_FORMAT_META[fmt].label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                נבחר: <span className="font-medium text-foreground">{OUTPUT_FORMAT_META[outputFormat].label}</span> • סיומת <span className="font-medium text-foreground">.{OUTPUT_FORMAT_META[outputFormat].ext}</span> • {OUTPUT_FORMAT_META[outputFormat].description}
              </div>
            </CardContent>
          </Card>

          {/* Drop Zone */}
          <div
            ref={dropZoneRef}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200",
              isDragging
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
            )}
          >
            <Upload className={cn("w-10 h-10 mx-auto mb-3", isDragging ? "text-primary" : "text-muted-foreground")} />
            <p className="font-medium text-lg">
              {isDragging ? "שחרר כאן..." : "גרור קבצים לכאן או לחץ לבחירה"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              MP4, MKV, AVI, MOV, WebM, FLV, WAV, FLAC, OGG ועוד
            </p>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_MIME}
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {/* Stats & Actions */}
          {jobs.length > 0 && (
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground">
                  {stats.done}/{stats.total} הושלמו
                </span>
                {stats.active > 0 && (
                  <Badge variant="default" className="gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {stats.active} פעילים
                  </Badge>
                )}
                {stats.queued > 0 && (
                  <Badge variant="outline">{stats.queued} בתור</Badge>
                )}
                {stats.errors > 0 && (
                  <Badge variant="destructive">{stats.errors} שגיאות</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {stats.done > 0 && (
                  <Button variant="secondary" size="sm" onClick={handleEnhanceAllConverted} className="gap-1">
                    <Sparkles className="w-4 h-4" />
                    שפר הכל ברקע
                  </Button>
                )}
                {stats.done > 1 && (
                  <Button variant="outline" size="sm" onClick={handleDownloadAll} className="gap-1">
                    <FolderDown className="w-4 h-4" />
                    הורד הכל ({stats.done})
                  </Button>
                )}
                {(stats.done > 0 || stats.errors > 0) && (
                  <Button variant="ghost" size="sm" onClick={handleClearDone} className="gap-1 text-muted-foreground">
                    <Trash2 className="w-4 h-4" />
                    נקה מושלמים
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Job List */}
          {jobs.length > 0 && (
            <ScrollArea className="max-h-[calc(100vh-420px)]">
              <div className="space-y-2 pb-2">
                {jobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onRemove={handleRemove}
                    onTranscribe={setPromptJob}
                    onSaveAndTranscribe={(j) => void handleSaveAndTranscribe(j)}
                    onRetry={handleRetry}
                    onCut={handleCutFromConverted}
                    onEnhance={setEnhanceTarget}
                  />
                ))}
              </div>
            </ScrollArea>
          )}

          {enhanceQueueStats.total > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    תור שיפור איכות ({enhanceQueueStats.total})
                  </span>
                  <div className="flex items-center gap-1">
                    {enhanceQueueStats.active > 0 && (
                      <Badge variant="default" className="gap-1 text-[10px]">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {enhanceQueueStats.active} משפרים
                      </Badge>
                    )}
                    {enhanceQueueStats.queued > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        {enhanceQueueStats.queued} בתור
                      </Badge>
                    )}
                    {(enhanceQueueStats.done > 0 || enhanceQueueStats.errors > 0) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={clearEnhanceQueueCompleted}
                      >
                        נקה הסתיימו
                      </Button>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5">
                  {enhanceQueueJobs.slice(0, 12).map((job) => (
                    <div key={job.id} className="flex items-center justify-between gap-2 border rounded-lg px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate">{job.sourceName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {job.preset === "ai_voice" ? "AI Voice" : "Auto EQ"} • {job.outputFormat.toUpperCase()}
                          {job.error ? ` • ${job.error}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {job.status === "queued" && <Badge variant="outline" className="text-[10px]">בתור</Badge>}
                        {job.status === "enhancing" && (
                          <Badge variant="default" className="gap-1 text-[10px]">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            משפר
                          </Badge>
                        )}
                        {job.status === "error" && <Badge variant="destructive" className="text-[10px]">שגיאה</Badge>}
                        {job.status === "done" && (
                          <>
                            <Badge variant="secondary" className="text-[10px]">הושלם</Badge>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleTranscribeEnhancedQueueJob(job)}>
                              <Mic className="w-3.5 h-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleDownloadEnhancedQueueJob(job)}>
                              <Download className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                        {job.status !== "enhancing" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => removeEnhanceQueueJob(job.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* ═══ Conversion History Table ═══ */}
          {isAuthenticated && history.items.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <History className="w-4 h-4 text-primary" />
                    היסטוריית המרות ({history.items.length})
                    {selectedHistoryIds.size > 0 && (
                      <Badge variant="secondary" className="text-[10px]">
                        {selectedHistoryIds.size} נבחרו
                      </Badge>
                    )}
                  </span>
                  <div className="flex items-center gap-1 flex-wrap">
                    {selectedHistoryIds.size > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive"
                        onClick={handleDeleteSelectedHistory}
                      >
                        <Trash2 className="w-3 h-3 ml-1" /> מחק נבחרים ({selectedHistoryIds.size})
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-primary"
                      onClick={toggleSelectAllHistory}
                    >
                      {selectedHistoryIds.size === history.items.length ? (
                        <><X className="w-3 h-3 ml-1" /> בטל בחירה</>
                      ) : (
                        <><ListChecks className="w-3 h-3 ml-1" /> בחר הכל</>
                      )}
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => history.refresh()}>
                      <RefreshCw className="w-3 h-3 ml-1" /> רענן
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive" onClick={() => {
                      if (confirm("למחוק את כל ההיסטוריה?")) history.removeAll();
                    }}>
                      <Trash2 className="w-3 h-3 ml-1" /> נקה הכל
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isMobile ? (
                  <div className="space-y-2">
                    {history.items.map((item) => (
                      <Card
                        key={item.id}
                        className={cn("border", selectedHistoryIds.has(item.id) && "ring-2 ring-primary")}
                      >
                        <CardContent className="p-3 space-y-2.5">
                          {/* Row 1: select + name + format */}
                          <div className="flex items-start gap-2">
                            <Checkbox
                              checked={selectedHistoryIds.has(item.id)}
                              onCheckedChange={() => toggleSelectHistory(item.id)}
                              aria-label={`בחר ${item.file_name}`}
                              className="mt-1 shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              {editingId === item.id ? (
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    className="h-9 text-sm"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') { history.updateName(item.id, editName); setEditingId(null); }
                                      else if (e.key === 'Escape') setEditingId(null);
                                    }}
                                  />
                                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => { history.updateName(item.id, editName); setEditingId(null); }}>
                                    <Check className="w-4 h-4" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setEditingId(null)}>
                                    <X className="w-4 h-4" />
                                  </Button>
                                </div>
                              ) : (
                                <p
                                  className="font-medium text-sm truncate cursor-pointer hover:text-primary"
                                  onClick={() => { setEditingId(item.id); setEditName(item.file_name); }}
                                  title="לחץ לעריכה"
                                >
                                  {item.file_name}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground truncate mt-0.5">{item.original_name}</p>
                            </div>
                            <Badge variant="outline" className="text-[10px] shrink-0">{item.output_format.toUpperCase()}</Badge>
                          </div>

                          {/* Row 2: meta */}
                          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                            <span>{item.output_size > 0 ? formatBytes(item.output_size) : '—'}</span>
                            <span>•</span>
                            <span className="whitespace-nowrap">
                              {new Date(item.created_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span>•</span>
                            {folderEditId === item.id ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  value={folderName}
                                  onChange={(e) => setFolderName(e.target.value)}
                                  className="h-8 text-xs w-28"
                                  placeholder="תיקייה"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') { history.updateFolder(item.id, folderName); setFolderEditId(null); }
                                    else if (e.key === 'Escape') setFolderEditId(null);
                                  }}
                                />
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { history.updateFolder(item.id, folderName); setFolderEditId(null); }}>
                                  <Check className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 cursor-pointer hover:text-primary"
                                onClick={() => { setFolderEditId(item.id); setFolderName(item.folder || ''); }}
                                title="לחץ להגדרת תיקייה"
                              >
                                <FolderOpen className="w-3.5 h-3.5" />
                                {item.folder || <span className="text-muted-foreground/50">ללא תיקייה</span>}
                              </span>
                            )}
                          </div>

                          {/* Row 3: actions */}
                          <div className="grid grid-cols-4 gap-1.5">
                            <Button variant="outline" size="sm" className="h-10" title="הורד קובץ" onClick={() => handleDownloadHistoryItem(item)}>
                              <Download className="w-4 h-4" />
                            </Button>
                            <Button variant="outline" size="sm" className="h-10" title="שנה שם" onClick={() => { setEditingId(item.id); setEditName(item.file_name); }}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="outline" size="sm" className="h-10" title="שלח לתמלול" onClick={() => navigate("/transcribe", { state: { fileName: item.file_name, filePath: item.file_path } })}>
                              <Mic className="w-4 h-4" />
                            </Button>
                            <Button variant="outline" size="sm" className="h-10 text-muted-foreground hover:text-destructive" title="מחק" onClick={() => history.removeItem(item.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                <ScrollArea className="max-h-[400px]">
                  <Table dir="rtl">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-center w-10">
                          <Checkbox
                            checked={history.items.length > 0 && selectedHistoryIds.size === history.items.length}
                            onCheckedChange={toggleSelectAllHistory}
                            aria-label="בחר הכל"
                          />
                        </TableHead>
                        <TableHead className="text-right">שם קובץ</TableHead>
                        <TableHead className="text-right">מקור</TableHead>
                        <TableHead className="text-center">פורמט</TableHead>
                        <TableHead className="text-center">גודל</TableHead>
                        <TableHead className="text-right">תיקייה</TableHead>
                        <TableHead className="text-right">תאריך</TableHead>
                        <TableHead className="text-center">פעולות</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.items.map((item) => (
                        <TableRow key={item.id} data-state={selectedHistoryIds.has(item.id) ? "selected" : undefined}>
                          {/* Selection checkbox */}
                          <TableCell className="text-center">
                            <Checkbox
                              checked={selectedHistoryIds.has(item.id)}
                              onCheckedChange={() => toggleSelectHistory(item.id)}
                              aria-label={`בחר ${item.file_name}`}
                            />
                          </TableCell>

                          {/* File name - editable */}
                          <TableCell className="font-medium max-w-[200px]">
                            {editingId === item.id ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  className="h-7 text-xs"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      history.updateName(item.id, editName);
                                      setEditingId(null);
                                    } else if (e.key === 'Escape') {
                                      setEditingId(null);
                                    }
                                  }}
                                />
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => {
                                  history.updateName(item.id, editName);
                                  setEditingId(null);
                                }}>
                                  <Check className="w-3 h-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingId(null)}>
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            ) : (
                              <span className="truncate block cursor-pointer hover:text-primary" onClick={() => {
                                setEditingId(item.id);
                                setEditName(item.file_name);
                              }} title="לחץ לעריכה">
                                {item.file_name}
                              </span>
                            )}
                          </TableCell>

                          {/* Original name - editable */}
                          <TableCell className="text-xs text-muted-foreground max-w-[180px]">
                            {editingOriginalId === item.id ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  value={editOriginalName}
                                  onChange={(e) => setEditOriginalName(e.target.value)}
                                  className="h-7 text-xs"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      history.updateOriginalName(item.id, editOriginalName);
                                      setEditingOriginalId(null);
                                    } else if (e.key === 'Escape') {
                                      setEditingOriginalId(null);
                                    }
                                  }}
                                />
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => {
                                  history.updateOriginalName(item.id, editOriginalName);
                                  setEditingOriginalId(null);
                                }}>
                                  <Check className="w-3 h-3" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingOriginalId(null)}>
                                  <X className="w-3 h-3" />
                                </Button>
                              </div>
                            ) : (
                              <span
                                className="truncate block cursor-pointer hover:text-primary"
                                onClick={() => {
                                  setEditingOriginalId(item.id);
                                  setEditOriginalName(item.original_name);
                                }}
                                title={`${item.original_name} — לחץ לעריכה`}
                              >
                                {item.original_name}
                              </span>
                            )}
                          </TableCell>

                          {/* Format */}
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-[10px]">{item.output_format.toUpperCase()}</Badge>
                          </TableCell>

                          {/* Size */}
                          <TableCell className="text-center text-xs text-muted-foreground">
                            {item.output_size > 0 ? formatBytes(item.output_size) : '—'}
                          </TableCell>

                          {/* Folder - editable */}
                          <TableCell>
                            {folderEditId === item.id ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  value={folderName}
                                  onChange={(e) => setFolderName(e.target.value)}
                                  className="h-7 text-xs w-24"
                                  placeholder="שם תיקייה"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      history.updateFolder(item.id, folderName);
                                      setFolderEditId(null);
                                    } else if (e.key === 'Escape') {
                                      setFolderEditId(null);
                                    }
                                  }}
                                />
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => {
                                  history.updateFolder(item.id, folderName);
                                  setFolderEditId(null);
                                }}>
                                  <Check className="w-3 h-3" />
                                </Button>
                              </div>
                            ) : (
                              <span
                                className="text-xs cursor-pointer hover:text-primary flex items-center gap-1"
                                onClick={() => {
                                  setFolderEditId(item.id);
                                  setFolderName(item.folder || '');
                                }}
                                title="לחץ להגדרת תיקייה"
                              >
                                <FolderOpen className="w-3 h-3 text-muted-foreground" />
                                {item.folder || <span className="text-muted-foreground/50">—</span>}
                              </span>
                            )}
                          </TableCell>

                          {/* Date */}
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(item.created_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </TableCell>

                          {/* Actions */}
                          <TableCell>
                            <div className="flex items-center justify-center gap-0.5">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="הורד קובץ"
                                onClick={() => handleDownloadHistoryItem(item)}
                              >
                                <Download className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="שנה שם" onClick={() => {
                                setEditingId(item.id);
                                setEditName(item.file_name);
                              }}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="שלח לתמלול" onClick={() => {
                                navigate("/transcribe", { state: { fileName: item.file_name, filePath: item.file_path } });
                              }}>
                                <Mic className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                title="מחק"
                                onClick={() => history.removeItem(item.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                )}
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {jobs.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-center text-muted-foreground">
                  אין קבצים בתור
                </CardTitle>
              </CardHeader>
              <CardContent className="text-center pb-6">
                <div className="flex justify-center gap-2 flex-wrap text-xs">
                  {["MP4", "MKV", "AVI", "MOV", "WebM", "FLV", "WAV", "FLAC", "OGG", "M4A", "WMV", "3GP"].map((ext) => (
                    <Badge key={ext} variant="outline" className="text-xs">
                      {ext}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="text-xs">+עוד</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  ⚡ ההמרה רצה ברקע באמצעות FFmpeg (בדפדפן/שרת) — כולל טעינה עצילה ותור מקבילי
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="cut" className="space-y-4">
          <Suspense
            fallback={
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  <span className="mr-2 text-sm text-muted-foreground">טוען מערכת חיתוך...</span>
                </CardContent>
              </Card>
            }
          >
            <AdvancedCutPanel
              initialFile={cutInitialFile ?? undefined}
              initialSourceLabel={cutInitialLabel || undefined}
              convertedFiles={doneJobs.map((j) => ({
                id: j.id,
                name: j.fileName,
                file: new File([j.outputBlob!], getOutputFileName(j.fileName, j.outputFormat), { type: OUTPUT_FORMAT_META[j.outputFormat].mime }),
              }))}
            />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* Aggregated completed-files panel (cut + convert results) */}
      <CompletedFilesPanel
        onTranscribe={(file) => navigate("/transcribe", { state: { file } })}
        onSaveAndTranscribe={async (file) => {
          // Pseudo-job to reuse the existing save+upload+navigate flow.
          const pseudo: ConversionJob = {
            id: `cf_${Date.now()}`,
            file,
            fileName: file.name,
            fileSize: file.size,
            outputFormat: (file.name.split(".").pop() as OutputFormat) || "mp3",
            outputBlob: file,
            outputUrl: URL.createObjectURL(file),
            status: "done",
            progress: 100,
            startedAt: Date.now(),
            finishedAt: Date.now(),
          } as unknown as ConversionJob;
          await handleSaveAndTranscribe(pseudo);
        }}
      />


      <AudioEnhanceDialog
        open={!!enhanceTarget}
        onOpenChange={(open) => {
          if (!open) setEnhanceTarget(null);
        }}
        file={enhanceTarget ? toOutputFile(enhanceTarget) : null}
        sourceLabel={enhanceTarget ? getOutputFileName(enhanceTarget.fileName, enhanceTarget.outputFormat) : undefined}
        defaultOutputFormat={enhanceTarget?.outputFormat === "aac" ? "aac" : enhanceTarget?.outputFormat === "opus" ? "opus" : "mp3"}
        onTranscribe={(file) => navigate("/transcribe", { state: { file } })}
      />
    </div>
  );
}
