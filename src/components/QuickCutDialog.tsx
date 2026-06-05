/**
 * QuickCutDialog — single global instance, opens via `openQuickCut()`.
 *
 * Flow:
 *  1. User picks a file (or one was passed via the open event).
 *  2. User picks a preset (halves / thirds / every-5-min) or custom count/time.
 *  3. We probe duration fast, then call `cutWithFallback` (tiered engine).
 *  4. Show the result list, with two actions:
 *       • Download all  – local downloads
 *       • Transcribe all – pushes every cut file into the background
 *                          transcription queue (`submitBatchJobs`).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Scissors, Upload, Download, Loader2, FileAudio, X, ListChecks } from "lucide-react";
import { toast } from "@/hooks/use-toast";
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

type Mode = "count" | "time";

export default function QuickCutDialog() {
  const [open, setOpen] = useState(false);
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { submitBatchJobs } = useTranscriptionJobs();
  const { preferences } = useCloudPreferences();

  // Reset when closing
  const resetAll = useCallback(() => {
    setFile(null);
    setDuration(null);
    setResults([]);
    setProgress(null);
    setTierUsed("");
    setIsCutting(false);
  }, []);

  // Listen to global open events
  useEffect(() => {
    return onOpenQuickCut(async (detail: OpenQuickCutDetail) => {
      setOpen(true);
      if (detail.file) {
        await loadFile(detail.file);
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
    if (!d) {
      toast({
        title: "אזהרה",
        description: "לא ניתן לחלץ אורך מראש — נחתוך בכל זאת באמצעות FFmpeg",
      });
    }
  }, []);

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void loadFile(f);
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

  const handleCut = async () => {
    if (!file) {
      toast({ title: "לא נבחר קובץ", variant: "destructive" });
      return;
    }
    const config = buildConfig();
    if (!config) {
      toast({ title: "הגדרות לא תקינות", variant: "destructive" });
      return;
    }

    setIsCutting(true);
    setResults([]);
    setProgress({ tier: "wav-slice", message: "מתחיל…", completed: 0, total: 1 });

    try {
      const outcome = await cutWithFallback(file, {
        config,
        knownDurationSec: duration ?? undefined,
        onProgress: (p) => setProgress(p),
      });
      setResults(outcome.results);
      setTierUsed(outcome.tier);
      toast({
        title: "✂️ חיתוך הושלם",
        description: `${outcome.results.length} מקטעים (מנוע: ${labelForTier(outcome.tier)})`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "שגיאת חיתוך", description: msg, variant: "destructive" });
    } finally {
      setIsCutting(false);
      setProgress(null);
    }
  };

  const handleDownloadAll = () => {
    for (const r of results) {
      const url = URL.createObjectURL(r.file);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleTranscribeAll = async () => {
    if (results.length === 0) return;
    setSendingToTranscribe(true);
    try {
      const engine = (preferences as { engine?: string }).engine || "groq";
      const lang = (preferences as { source_language?: string }).source_language || "he";
      const onlineEngine = (engine === "local" || engine === "local-server") ? "groq" : engine;
      const ids = await submitBatchJobs(
        results.map((r) => r.file),
        onlineEngine,
        lang,
      );
      toast({
        title: "נשלח לתור התמלול",
        description: `${ids.length} מקטעים בתור (מנוע: ${onlineEngine})`,
      });
    } finally {
      setSendingToTranscribe(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetAll(); }}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="w-5 h-5 text-yellow-600" />
            חיתוך מהיר
          </DialogTitle>
          <DialogDescription>
            חיתוך מדורג — מנסה את השיטה המהירה ביותר, ובכישלון עובר אוטומטית למנוע מתקדם יותר.
          </DialogDescription>
        </DialogHeader>

        {/* File picker */}
        {!file ? (
          <div className="border-2 border-dashed border-yellow-500/40 rounded-2xl p-8 text-center">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*"
              onChange={handleFilePick}
              className="hidden"
            />
            <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              בחר קובץ אודיו/וידאו לחיתוך
            </p>
            <Button onClick={() => fileInputRef.current?.click()} variant="default">
              בחר קובץ
            </Button>
          </div>
        ) : (
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
            <Button size="icon" variant="ghost" onClick={resetAll} disabled={isCutting}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Cut config */}
        {file && results.length === 0 && (
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="count">לפי כמות חלקים</TabsTrigger>
              <TabsTrigger value="time">לפי משך זמן</TabsTrigger>
            </TabsList>
            <TabsContent value="count" className="space-y-3 pt-3">
              <div className="flex gap-2">
                {[2, 3, 4, 5, 10].map((n) => (
                  <Button
                    key={n}
                    variant={partCount === String(n) ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPartCount(String(n))}
                  >
                    {n} חלקים
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-32">כמות חלקים:</Label>
                <Input
                  type="number"
                  min={2}
                  max={100}
                  value={partCount}
                  onChange={(e) => setPartCount(e.target.value)}
                  className="w-24"
                />
              </div>
            </TabsContent>
            <TabsContent value="time" className="space-y-3 pt-3">
              <div className="flex gap-2">
                {[1, 5, 10, 15, 30].map((n) => (
                  <Button
                    key={n}
                    variant={chunkMinutes === String(n) ? "default" : "outline"}
                    size="sm"
                    onClick={() => setChunkMinutes(String(n))}
                  >
                    כל {n} דק'
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Label className="w-32">דקות לקטע:</Label>
                <Input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={chunkMinutes}
                  onChange={(e) => setChunkMinutes(e.target.value)}
                  className="w-24"
                />
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* Progress */}
        {isCutting && progress && (
          <div className="space-y-2 rounded-xl border bg-yellow-50 dark:bg-yellow-950/20 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-yellow-600" />
              <span className="font-medium">{labelForTier(progress.tier)}</span>
              <span className="text-muted-foreground">— {progress.message}</span>
            </div>
            <Progress value={(progress.completed / Math.max(1, progress.total)) * 100} />
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <ListChecks className="w-4 h-4" />
              {results.length} מקטעים נוצרו · מנוע: {labelForTier(tierUsed)}
            </div>
            <div className="max-h-64 overflow-y-auto rounded-xl border divide-y">
              {results.map((r) => (
                <div key={r.segmentIndex} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="text-xs text-muted-foreground w-6">{r.segmentIndex + 1}.</span>
                  <span className="flex-1 truncate">{r.file.name}</span>
                  <span className="text-xs text-muted-foreground">{formatTime(r.durationSec)}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(r.sizeBytes)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {results.length === 0 ? (
            <Button
              onClick={handleCut}
              disabled={!file || isCutting}
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              {isCutting ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Scissors className="w-4 h-4 ml-2" />}
              חתוך
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleDownloadAll}>
                <Download className="w-4 h-4 ml-2" />
                הורד הכל
              </Button>
              <Button
                onClick={handleTranscribeAll}
                disabled={sendingToTranscribe}
                className="bg-yellow-600 hover:bg-yellow-700"
              >
                {sendingToTranscribe ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                ) : (
                  <ListChecks className="w-4 h-4 ml-2" />
                )}
                תמלל הכל
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function labelForTier(tier: string): string {
  switch (tier) {
    case "wav-slice": return "חיתוך WAV מהיר";
    case "ffmpeg-copy": return "FFmpeg (ללא קידוד מחדש)";
    case "audio-buffer": return "פיענוח מלא";
    default: return tier || "—";
  }
}
