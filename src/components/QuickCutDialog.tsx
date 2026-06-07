/**
 * QuickCutDialog — single global instance, opens via `openQuickCut()`.
 *
 * Mobile-first redesign:
 *  - On mobile: full-screen Sheet from the bottom with a sticky CTA footer.
 *  - On desktop: classic centered Dialog.
 *  - 3-step stepper: 1) קובץ  2) הגדרות  3) תוצאות
 *  - Result list = cards with mini <audio> player + per-segment actions.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Scissors, Upload, Download, Loader2, FileAudio, X, ListChecks,
  Check, ChevronRight, Mic, Music, RotateCcw, FileAudio2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { onOpenQuickCut, type OpenQuickCutDetail } from "@/lib/quickCutBus";
import {
  cutWithFallback,
  probeDurationFast,
  type CutJobConfig,
  type CutResult,
  type TieredCutProgress,
} from "@/lib/tieredCutEngine";
import {
  convertAudio,
  onJobUpdate,
  type ConversionJob,
  type OutputFormat,
} from "@/lib/ffmpegConverter";
import { useTranscriptionJobs } from "@/hooks/useTranscriptionJobs";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import { formatTime } from "@/lib/audioCutEngine";

type ConvFormat = "none" | OutputFormat;
type Mode = "count" | "time";
type Step = 1 | 2 | 3;

/** Run convertAudio and resolve with the produced File once the job finishes. */
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function labelForTier(tier: string): string {
  switch (tier) {
    case "wav-slice": return "חיתוך WAV מהיר";
    case "ffmpeg-copy": return "FFmpeg (ללא קידוד מחדש)";
    case "audio-buffer": return "פיענוח מלא";
    default: return tier || "—";
  }
}

// ─── Stepper ────────────────────────────────────────────────────────────────
function Stepper({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 1, label: "קובץ" },
    { id: 2, label: "הגדרות" },
    { id: 3, label: "תוצאות" },
  ];
  return (
    <div className="flex items-center justify-between gap-1 px-1" dir="rtl">
      {steps.map((s, i) => {
        const done = step > s.id;
        const active = step === s.id;
        return (
          <div key={s.id} className="flex items-center gap-1 flex-1">
            <div
              className={cn(
                "flex items-center gap-1.5 flex-1 min-w-0",
                active && "text-yellow-700 dark:text-yellow-500"
              )}
            >
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold border-2 shrink-0 transition-colors",
                  done && "bg-yellow-600 border-yellow-600 text-white",
                  active && "border-yellow-600 text-yellow-700 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-950/40",
                  !done && !active && "border-muted-foreground/30 text-muted-foreground"
                )}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : s.id}
              </div>
              <span className={cn("text-xs sm:text-sm font-medium truncate", !active && !done && "text-muted-foreground")}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn("h-px flex-1 mx-1", done ? "bg-yellow-600" : "bg-muted-foreground/20")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Segment Card ───────────────────────────────────────────────────────────
function SegmentCard({
  result,
  convertedFile,
  isConverting,
  onDownload,
  onTranscribe,
  onConvert,
}: {
  result: CutResult;
  convertedFile?: File;
  isConverting?: boolean;
  onDownload: () => void;
  onTranscribe: () => void;
  onConvert: (fmt: OutputFormat) => void;
}) {
  const fileToUse = convertedFile ?? result.file;
  const [url, setUrl] = useState<string>("");

  useEffect(() => {
    const u = URL.createObjectURL(fileToUse);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [fileToUse]);

  return (
    <div className="rounded-xl border bg-card p-3 space-y-2 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="rounded-lg bg-yellow-500/10 p-2 shrink-0">
          <FileAudio className="w-4 h-4 text-yellow-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-5 text-[10px] px-1.5">
              #{result.segmentIndex + 1}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatTime(result.durationSec)} · {formatBytes(fileToUse.size)}
            </span>
            {convertedFile && (
              <Badge variant="secondary" className="h-5 text-[10px] px-1.5">
                הומר
              </Badge>
            )}
          </div>
          <p className="text-xs font-medium truncate mt-0.5" title={fileToUse.name}>
            {fileToUse.name}
          </p>
        </div>
      </div>
      {url && (
        <audio
          src={url}
          controls
          preload="none"
          className="w-full h-9"
          style={{ minHeight: 36 }}
        />
      )}
      <div className="grid grid-cols-3 gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8" disabled={isConverting}>
              {isConverting ? (
                <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" />
              ) : (
                <Music className="w-3.5 h-3.5 ml-1" />
              )}
              המר
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
        <Button variant="outline" size="sm" onClick={onDownload} className="h-8">
          <Download className="w-3.5 h-3.5 ml-1" />
          הורד
        </Button>
        <Button
          size="sm"
          onClick={onTranscribe}
          className="h-8 bg-yellow-600 hover:bg-yellow-700"
        >
          <Mic className="w-3.5 h-3.5 ml-1" />
          תמלל
        </Button>
      </div>
    </div>
  );
}

// ─── Pipeline Progress ─────────────────────────────────────────────────────
type StageKey = "cut" | "convert" | "transcribe";
type StageStatus = "pending" | "running" | "done" | "error";
interface PipelineStage {
  key: StageKey;
  label: string;
  status: StageStatus;
  percent: number; // 0-100
  detail?: string;
}

function PipelineProgress({ stages }: { stages: PipelineStage[] }) {
  const active = stages.filter((s) => s.status !== "pending");
  const overall = active.length
    ? Math.round(active.reduce((a, s) => a + (s.status === "done" ? 100 : s.percent), 0) / active.length)
    : 0;
  const allDone = stages.length > 0 && stages.every((s) => s.status === "done");
  return (
    <div className="space-y-2.5 rounded-xl border bg-yellow-50 dark:bg-yellow-950/20 p-3" dir="rtl">
      <div className="flex items-center gap-2 text-sm">
        {allDone ? (
          <Check className="w-4 h-4 text-green-600" />
        ) : (
          <Loader2 className="w-4 h-4 animate-spin text-yellow-600" />
        )}
        <span className="font-semibold">התקדמות כללית</span>
        <span className="mr-auto text-sm font-bold tabular-nums">{overall}%</span>
      </div>
      <Progress value={overall} className="h-2" />
      <div className="space-y-1.5 pt-1">
        {stages.map((s) => {
          const pct = s.status === "done" ? 100 : Math.round(s.percent);
          return (
            <div key={s.key} className="space-y-0.5">
              <div className="flex items-center gap-2 text-xs">
                {s.status === "done" ? (
                  <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
                ) : s.status === "running" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-600 shrink-0" />
                ) : s.status === "error" ? (
                  <X className="w-3.5 h-3.5 text-destructive shrink-0" />
                ) : (
                  <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground/30 shrink-0" />
                )}
                <span className={cn(
                  "font-medium",
                  s.status === "pending" && "text-muted-foreground",
                  s.status === "done" && "text-green-700 dark:text-green-500"
                )}>
                  {s.label}
                </span>
                {s.detail && (
                  <span className="text-muted-foreground truncate">— {s.detail}</span>
                )}
                <span className="mr-auto tabular-nums font-semibold">{pct}%</span>
              </div>
              <Progress value={pct} className="h-1" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Dialog ────────────────────────────────────────────────────────────
export default function QuickCutDialog() {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);

  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [isProbing, setIsProbing] = useState(false);

  const [mode, setMode] = useState<Mode>("count");
  const [partCount, setPartCount] = useState("3");
  const [chunkMinutes, setChunkMinutes] = useState("5");

  const [isCutting, setIsCutting] = useState(false);
  const [progress, setProgress] = useState<TieredCutProgress | null>(null);
  const [results, setResults] = useState<CutResult[]>([]);
  const [tierUsed, setTierUsed] = useState<string>("");

  const [sendingToTranscribe, setSendingToTranscribe] = useState(false);
  const [outputFormat, setOutputFormat] = useState<ConvFormat>("mp3");
  const [autoTranscribe, setAutoTranscribe] = useState(true);
  const [isConverting, setIsConverting] = useState(false);
  const [convProgress, setConvProgress] = useState<{ done: number; total: number } | null>(null);
  const [convertedFiles, setConvertedFiles] = useState<File[]>([]);
  const [segConverting, setSegConverting] = useState<Record<number, boolean>>({});
  const [pipeline, setPipeline] = useState<PipelineStage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { submitBatchJobs } = useTranscriptionJobs();
  const { preferences } = useCloudPreferences();

  const updateStage = useCallback((key: StageKey, patch: Partial<PipelineStage>) => {
    setPipeline((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  const resetAll = useCallback(() => {
    setFile(null);
    setDuration(null);
    setResults([]);
    setProgress(null);
    setTierUsed("");
    setIsCutting(false);
    setConvertedFiles([]);
    setConvProgress(null);
    setIsConverting(false);
    setPipeline([]);
    setStep(1);
  }, []);

  useEffect(() => {
    return onOpenQuickCut(async (detail: OpenQuickCutDetail) => {
      setOpen(true);
      setStep(1);
      if (detail.file) {
        await loadFile(detail.file);
        setStep(2);
      }
      if (detail.preset === "halves") { setMode("count"); setPartCount("2"); }
      if (detail.preset === "thirds") { setMode("count"); setPartCount("3"); }
      if (detail.preset === "every5min") { setMode("time"); setChunkMinutes("5"); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFile = useCallback(async (f: File) => {
    setFile(f);
    setResults([]);
    setDuration(null);
    setIsProbing(true);
    const d = await probeDurationFast(f);
    setDuration(d);
    setIsProbing(false);
  }, []);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      void loadFile(f);
      setStep(2);
    }
    e.target.value = "";
  };

  const buildConfig = (): CutJobConfig | null => {
    if (mode === "count") {
      const n = parseInt(partCount, 10);
      if (!n || n < 2) return null;
      return { mode: "count", partCount: n };
    }
    const sec = (parseFloat(chunkMinutes) || 0) * 60;
    if (sec <= 0) return null;
    return { mode: "time", chunkDurationSec: sec };
  };

  const runCut = async (): Promise<CutResult[] | null> => {
    if (!file) return null;
    const config = buildConfig();
    if (!config) {
      toast({ title: "הגדרות לא תקינות", variant: "destructive" });
      return null;
    }
    setIsCutting(true);
    setResults([]);
    setConvertedFiles([]);
    setProgress({ tier: "wav-slice", message: "מתחיל…", completed: 0, total: 1 });
    updateStage("cut", { status: "running", percent: 1, detail: "מתחיל…" });
    try {
      const outcome = await cutWithFallback(file, {
        config,
        knownDurationSec: duration ?? undefined,
        onProgress: (p) => {
          setProgress(p);
          const pct = Math.max(1, Math.min(99, Math.round((p.completed / Math.max(1, p.total)) * 100)));
          updateStage("cut", { status: "running", percent: pct, detail: p.message });
        },
      });
      setResults(outcome.results);
      setTierUsed(outcome.tier);
      updateStage("cut", { status: "done", percent: 100, detail: `${outcome.results.length} מקטעים` });
      setStep(3);
      toast({
        title: "✂️ חיתוך הושלם",
        description: `${outcome.results.length} מקטעים (${labelForTier(outcome.tier)})`,
      });
      return outcome.results;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateStage("cut", { status: "error", detail: msg });
      toast({ title: "שגיאת חיתוך", description: msg, variant: "destructive" });
      return null;
    } finally {
      setIsCutting(false);
      setProgress(null);
    }
  };

  const runConvertAll = async (segments: CutResult[]): Promise<File[]> => {
    if (outputFormat === "none" || segments.length === 0) {
      return segments.map((r) => r.file);
    }
    setIsConverting(true);
    setConvProgress({ done: 0, total: segments.length });
    updateStage("convert", { status: "running", percent: 1, detail: `0/${segments.length}` });
    const out: File[] = [];
    try {
      for (let i = 0; i < segments.length; i++) {
        const converted = await convertOne(segments[i].file, outputFormat as OutputFormat);
        out.push(converted);
        setConvProgress({ done: i + 1, total: segments.length });
        const pct = Math.round(((i + 1) / segments.length) * 100);
        updateStage("convert", {
          status: i + 1 === segments.length ? "done" : "running",
          percent: pct,
          detail: `${i + 1}/${segments.length}`,
        });
      }
      setConvertedFiles(out);
      toast({
        title: "✅ המרה הושלמה",
        description: `${out.length} מקטעים הומרו ל-${(outputFormat as string).toUpperCase()}`,
      });
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateStage("convert", { status: "error", detail: msg });
      toast({ title: "שגיאת המרה", description: msg, variant: "destructive" });
      throw e;
    } finally {
      setIsConverting(false);
    }
  };

  const sendFilesToTranscribe = async (files: File[]) => {
    const engine = (preferences as { engine?: string }).engine || "groq";
    const lang = (preferences as { source_language?: string }).source_language || "he";
    const onlineEngine = (engine === "local" || engine === "local-server") ? "groq" : engine;
    updateStage("transcribe", { status: "running", percent: 10, detail: `שולח ${files.length} מקטעים…` });
    try {
      const ids = await submitBatchJobs(files, onlineEngine, lang);
      updateStage("transcribe", {
        status: "done",
        percent: 100,
        detail: `${ids.length} בתור (${onlineEngine})`,
      });
      toast({
        title: "נשלח לתור התמלול",
        description: `${ids.length} מקטעים בתור (מנוע: ${onlineEngine})`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateStage("transcribe", { status: "error", detail: msg });
      throw e;
    }
  };


  const convertSegmentTo = async (idx: number, fmt: OutputFormat) => {
    const seg = results[idx];
    if (!seg) return;
    setSegConverting((s) => ({ ...s, [idx]: true }));
    try {
      const out = await convertOne(seg.file, fmt);
      setConvertedFiles((prev) => {
        const next = [...prev];
        next[idx] = out;
        return next;
      });
      toast({ title: "✅ הומר", description: `${out.name}` });
    } catch (e) {
      toast({
        title: "שגיאת המרה",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSegConverting((s) => { const n = { ...s }; delete n[idx]; return n; });
    }
  };

  const convertAllAs = async (fmt: OutputFormat) => {
    setOutputFormat(fmt);
    try {
      await runConvertAll(results);
    } catch { /* toast shown */ }
  };


  const downloadOne = (f: File) => {
    const url = URL.createObjectURL(f);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleDownloadAll = () => {
    const files = convertedFiles.length > 0 ? convertedFiles : results.map((r) => r.file);
    for (const f of files) downloadOne(f);
  };

  const handleTranscribeAll = async () => {
    if (results.length === 0) return;
    setSendingToTranscribe(true);
    try {
      const filesToSend = convertedFiles.length > 0
        ? convertedFiles
        : results.map((r) => r.file);
      await sendFilesToTranscribe(filesToSend);
    } finally {
      setSendingToTranscribe(false);
    }
  };

  const handleConvertAndTranscribe = async () => {
    setSendingToTranscribe(true);
    try {
      const files = await runConvertAll(results);
      if (autoTranscribe) await sendFilesToTranscribe(files);
    } catch { /* toast shown */ } finally {
      setSendingToTranscribe(false);
    }
  };

  /** One-click full pipeline triggered from step-2 CTA. */
  const handleDoEverything = async () => {
    const segs = await runCut();
    if (!segs || segs.length === 0) return;
    setSendingToTranscribe(true);
    try {
      const files = outputFormat !== "none"
        ? await runConvertAll(segs)
        : segs.map((r) => r.file);
      if (autoTranscribe) await sendFilesToTranscribe(files);
    } catch { /* toast shown */ } finally {
      setSendingToTranscribe(false);
    }
  };

  const busy = isCutting || isConverting || sendingToTranscribe;

  const primaryCtaLabel = useMemo(() => {
    if (outputFormat !== "none" && autoTranscribe) return "חתוך, המר ותמלל";
    if (outputFormat !== "none") return "חתוך והמר";
    if (autoTranscribe) return "חתוך ותמלל";
    return "חתוך";
  }, [outputFormat, autoTranscribe]);

  // ─── Body content (shared across Sheet/Dialog) ───
  const body = (
    <div className="flex flex-col gap-3 flex-1 min-h-0">
      <Stepper step={step} />

      <div className="overflow-y-auto flex-1 -mx-1 px-1 space-y-3">
        {/* STEP 1 — File picker */}
        {step === 1 && (
          <div className="border-2 border-dashed border-yellow-500/40 rounded-2xl p-6 sm:p-8 text-center bg-yellow-50/30 dark:bg-yellow-950/10">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              onChange={handleFilePick}
              className="hidden"
            />
            <div className="w-14 h-14 rounded-full bg-yellow-500/10 flex items-center justify-center mx-auto mb-3">
              <Upload className="w-7 h-7 text-yellow-600" />
            </div>
            <p className="text-sm font-medium mb-1">בחר קובץ אודיו או וידאו</p>
            <p className="text-xs text-muted-foreground mb-4">
              MP3, WAV, M4A, MP4, MKV ועוד
            </p>
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="bg-yellow-600 hover:bg-yellow-700 w-full sm:w-auto"
            >
              <Upload className="w-4 h-4 ml-2" />
              בחר קובץ
            </Button>
          </div>
        )}

        {/* STEP 2 — Settings */}
        {step === 2 && file && (
          <>
            {/* file pill */}
            <div className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2">
              <FileAudio className="w-4 h-4 text-yellow-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{file.name}</div>
                <div className="text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                  {isProbing && " · בודק אורך…"}
                  {duration !== null && ` · ${formatTime(duration)}`}
                </div>
              </div>
              <Button size="icon" variant="ghost" onClick={resetAll} disabled={busy} className="h-8 w-8">
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* cut mode */}
            <div className="rounded-xl border p-3 space-y-3 bg-card">
              <div className="text-sm font-semibold flex items-center gap-1.5">
                <Scissors className="w-4 h-4 text-yellow-600" />
                איך לחתוך?
              </div>
              <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="count">לפי כמות חלקים</TabsTrigger>
                  <TabsTrigger value="time">לפי משך זמן</TabsTrigger>
                </TabsList>
                <TabsContent value="count" className="space-y-2 pt-3">
                  <div className="grid grid-cols-5 gap-1.5">
                    {[2, 3, 4, 5, 10].map((n) => (
                      <Button
                        key={n}
                        variant={partCount === String(n) ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPartCount(String(n))}
                        className={cn(
                          "h-9 px-0",
                          partCount === String(n) && "bg-yellow-600 hover:bg-yellow-700"
                        )}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">כמות מותאמת:</Label>
                    <Input
                      type="number"
                      min={2}
                      max={100}
                      value={partCount}
                      onChange={(e) => setPartCount(e.target.value)}
                      className="w-20 h-8 text-sm"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="time" className="space-y-2 pt-3">
                  <div className="grid grid-cols-5 gap-1.5">
                    {[1, 5, 10, 15, 30].map((n) => (
                      <Button
                        key={n}
                        variant={chunkMinutes === String(n) ? "default" : "outline"}
                        size="sm"
                        onClick={() => setChunkMinutes(String(n))}
                        className={cn(
                          "h-9 px-0 text-xs",
                          chunkMinutes === String(n) && "bg-yellow-600 hover:bg-yellow-700"
                        )}
                      >
                        {n} דק'
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">דקות לקטע:</Label>
                    <Input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={chunkMinutes}
                      onChange={(e) => setChunkMinutes(e.target.value)}
                      className="w-20 h-8 text-sm"
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Format */}
            <div className="rounded-xl border p-3 space-y-2 bg-card">
              <div className="text-sm font-semibold flex items-center gap-1.5">
                <Music className="w-4 h-4 text-yellow-600" />
                המרה לאחר חיתוך
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  { v: "none", l: "ללא" },
                  { v: "mp3", l: "MP3" },
                  { v: "opus", l: "Opus" },
                  { v: "aac", l: "AAC" },
                ] as { v: ConvFormat; l: string }[]).map((opt) => (
                  <Button
                    key={opt.v}
                    variant={outputFormat === opt.v ? "default" : "outline"}
                    size="sm"
                    onClick={() => setOutputFormat(opt.v)}
                    disabled={busy}
                    className={cn(
                      "h-9 px-0 text-xs",
                      outputFormat === opt.v && "bg-yellow-600 hover:bg-yellow-700"
                    )}
                  >
                    {opt.l}
                  </Button>
                ))}
              </div>
            </div>

            {/* Auto-transcribe */}
            <label className="flex items-center justify-between gap-2 rounded-xl border p-3 cursor-pointer bg-card">
              <div className="flex items-center gap-2">
                <Mic className="w-4 h-4 text-yellow-600" />
                <div>
                  <div className="text-sm font-medium">תמלל אוטומטית בסיום</div>
                  <div className="text-xs text-muted-foreground">שליחה ישירה לתור תמלול ברקע</div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={autoTranscribe}
                onChange={(e) => setAutoTranscribe(e.target.checked)}
                className="w-5 h-5 accent-yellow-600 shrink-0"
              />
            </label>

            {/* Cut progress */}
            {isCutting && progress && (
              <div className="space-y-2 rounded-xl border bg-yellow-50 dark:bg-yellow-950/20 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-yellow-600" />
                  <span className="font-medium">{labelForTier(progress.tier)}</span>
                </div>
                <div className="text-xs text-muted-foreground">{progress.message}</div>
                <Progress value={(progress.completed / Math.max(1, progress.total)) * 100} className="h-1.5" />
              </div>
            )}

            {/* Conv progress */}
            {isConverting && convProgress && (
              <div className="space-y-2 rounded-xl border bg-yellow-50 dark:bg-yellow-950/20 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-yellow-600" />
                  <span className="font-medium">
                    ממיר ל-{(outputFormat as string).toUpperCase()}
                  </span>
                  <span className="text-muted-foreground">
                    — {convProgress.done}/{convProgress.total}
                  </span>
                </div>
                <Progress value={(convProgress.done / Math.max(1, convProgress.total)) * 100} className="h-1.5" />
              </div>
            )}
          </>
        )}

        {/* STEP 3 — Results */}
        {step === 3 && results.length > 0 && (
          <>
            <div className="rounded-xl border bg-green-50 dark:bg-green-950/20 p-3 flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                <Check className="w-4 h-4 text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold">
                  {results.length} מקטעים מוכנים
                </div>
                <div className="text-xs text-muted-foreground">
                  מנוע: {labelForTier(tierUsed)}
                  {convertedFiles.length > 0 && ` · הומרו ל-${(outputFormat as string).toUpperCase()}`}
                </div>
              </div>
            </div>

            {/* Global actions — Convert (dropdown) + Transcribe-all icons */}
            <div className="flex items-center gap-2 px-1">
              <span className="text-xs text-muted-foreground flex-1">פעולות על כל המקטעים:</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1" disabled={busy}>
                    {isConverting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <FileAudio2 className="w-3.5 h-3.5" />
                    )}
                    המר הכל
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel className="text-xs">המר את כל המקטעים ל-</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(["mp3", "opus", "aac"] as OutputFormat[]).map((f) => (
                    <DropdownMenuItem key={f} onClick={() => convertAllAs(f)}>
                      {f.toUpperCase()}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                onClick={handleTranscribeAll}
                disabled={busy}
                className="h-8 gap-1 bg-yellow-600 hover:bg-yellow-700"
              >
                {sendingToTranscribe ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Mic className="w-3.5 h-3.5" />
                )}
                תמלל הכל
              </Button>
            </div>

            {isConverting && convProgress && (
              <div className="space-y-2 rounded-xl border bg-yellow-50 dark:bg-yellow-950/20 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-yellow-600" />
                  <span className="font-medium">ממיר…</span>
                  <span className="text-muted-foreground">
                    {convProgress.done}/{convProgress.total}
                  </span>
                </div>
                <Progress value={(convProgress.done / Math.max(1, convProgress.total)) * 100} className="h-1.5" />
              </div>
            )}

            <div className="space-y-2">
              {results.map((r, i) => (
                <SegmentCard
                  key={r.segmentIndex}
                  result={r}
                  convertedFile={convertedFiles[i]}
                  isConverting={!!segConverting[i]}
                  onDownload={() => downloadOne(convertedFiles[i] ?? r.file)}
                  onConvert={(fmt) => void convertSegmentTo(i, fmt)}
                  onTranscribe={async () => {
                    setSendingToTranscribe(true);
                    try {
                      await sendFilesToTranscribe([convertedFiles[i] ?? r.file]);
                    } finally {
                      setSendingToTranscribe(false);
                    }
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Sticky CTA footer */}
      <div className="border-t pt-3 mt-1 space-y-2 bg-background">
        {step === 1 && (
          <p className="text-xs text-center text-muted-foreground">
            בחר קובץ להמשך
          </p>
        )}

        {step === 2 && (
          <>
            <Button
              onClick={handleDoEverything}
              disabled={!file || busy}
              className="w-full h-11 bg-yellow-600 hover:bg-yellow-700 text-base"
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin ml-2" />
              ) : (
                <Scissors className="w-4 h-4 ml-2" />
              )}
              {primaryCtaLabel}
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                disabled={busy}
                className="h-9"
              >
                <ChevronRight className="w-4 h-4 ml-1" />
                החלף קובץ
              </Button>
              <Button
                variant="outline"
                onClick={() => void runCut()}
                disabled={!file || busy}
                className="h-9"
              >
                <Scissors className="w-4 h-4 ml-1" />
                חתוך בלבד
              </Button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={handleDownloadAll}
                disabled={busy}
                className="h-10"
              >
                <Download className="w-4 h-4 ml-1" />
                הורד הכל
              </Button>
              <Button
                onClick={handleTranscribeAll}
                disabled={busy}
                className="h-10 bg-yellow-600 hover:bg-yellow-700"
              >
                {sendingToTranscribe ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-1" />
                ) : (
                  <ListChecks className="w-4 h-4 ml-1" />
                )}
                תמלל הכל
              </Button>
            </div>
            {outputFormat !== "none" && convertedFiles.length === 0 && (
              <Button
                variant="outline"
                onClick={handleConvertAndTranscribe}
                disabled={busy}
                className="w-full h-9"
              >
                {isConverting ? <Loader2 className="w-4 h-4 animate-spin ml-1" /> : <Music className="w-4 h-4 ml-1" />}
                המר ל-{(outputFormat as string).toUpperCase()}
                {autoTranscribe && " + תמלל"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setResults([]); setConvertedFiles([]); setStep(2); }}
              disabled={busy}
              className="w-full h-8 text-xs text-muted-foreground"
            >
              <RotateCcw className="w-3.5 h-3.5 ml-1" />
              חתוך שוב עם הגדרות אחרות
            </Button>
          </>
        )}
      </div>
    </div>
  );

  const title = (
    <span className="flex items-center gap-2">
      <Scissors className="w-5 h-5 text-yellow-600" />
      חיתוך מהיר
    </span>
  );

  const description = "חיתוך מדורג — מנסה את השיטה המהירה ביותר, ובכישלון עובר אוטומטית למנוע מתקדם יותר.";

  // Mobile: full-height bottom sheet
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetAll(); }}>
        <SheetContent
          side="bottom"
          className="h-[100dvh] max-h-[100dvh] p-0 flex flex-col rounded-t-2xl"
          dir="rtl"
        >
          <SheetHeader className="p-4 pb-2 text-right border-b shrink-0">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription className="text-xs">{description}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 min-h-0 flex flex-col p-4 pt-3">
            {body}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: classic dialog
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetAll(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 flex flex-col">
          {body}
        </div>
      </DialogContent>
    </Dialog>
  );
}
