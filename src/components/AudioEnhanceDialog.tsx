import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Mic, Download, Loader2 } from "lucide-react";
import { SyncAudioPlayer } from "@/components/SyncAudioPlayer";
import { toast } from "@/hooks/use-toast";
import {
  enhanceAudioOnServer,
  recommendEnhancementForTranscription,
  type EnhancementRecommendation,
  type EnhancementOutputFormat,
  type EnhancementPreset,
} from "@/lib/audioEnhancement";
import { submitEnhanceJob } from "@/lib/audioEnhanceQueue";
import { extractAudioSegment, probeAudioDurationSec } from "@/lib/audioSegment";

interface AudioEnhanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File | null;
  sourceLabel?: string;
  onTranscribe?: (file: File) => void;
  defaultOutputFormat?: EnhancementOutputFormat;
}

const PRESET_OPTIONS: Array<{ id: EnhancementPreset; label: string; description: string; ai: boolean; group: "classic" | "ai" }> = [
  // Classic FFmpeg presets
  { id: "clean", label: "נקי", description: "שיפור קלאסי ללא AI", ai: false, group: "classic" },
  { id: "podcast", label: "פודקאסט", description: "חם ומאוזן לדיבור", ai: false, group: "classic" },
  { id: "broadcast", label: "שידור", description: "צליל הדוק וברור", ai: false, group: "classic" },
  { id: "ai_voice", label: "AI Voice", description: "ניקוי ודגש קולי (FFmpeg)", ai: false, group: "classic" },
  // AI neural enhancement presets
  { id: "ai_denoise", label: "AI ניקוי רעש", description: "ניקוי רעשי רקע חכם (מהיר)", ai: true, group: "ai" },
  { id: "ai_enhance", label: "AI שיפור דיבור", description: "שיפור עמוק עם MetricGAN-U (GPU)", ai: true, group: "ai" },
  { id: "ai_full", label: "AI שיפור מלא", description: "ניקוי + שיפור דו-שלבי (GPU)", ai: true, group: "ai" },
  { id: "ai_hebrew", label: "AI עברית", description: "מותאם לדיבור עברי — שומר עיצורים חיכוכיים", ai: true, group: "ai" },
];

const OUTPUT_OPTIONS: Array<{ id: EnhancementOutputFormat; label: string; ext: string }> = [
  { id: "mp3", label: "MP3", ext: ".mp3" },
  { id: "opus", label: "OPUS", ext: ".opus" },
  { id: "aac", label: "AAC", ext: ".m4a" },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function AudioEnhanceDialog({
  open,
  onOpenChange,
  file,
  sourceLabel,
  onTranscribe,
  defaultOutputFormat = "mp3",
}: AudioEnhanceDialogProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [preset, setPreset] = useState<EnhancementPreset>("ai_voice");
  const [outputFormat, setOutputFormat] = useState<EnhancementOutputFormat>(defaultOutputFormat);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [enhancedFile, setEnhancedFile] = useState<File | null>(null);
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<"full" | "part">("full");
  const [partStartSec, setPartStartSec] = useState("0");
  const [partDurationSec, setPartDurationSec] = useState("120");
  const [sourceDurationSec, setSourceDurationSec] = useState<number | null>(null);
  const [isRecommending, setIsRecommending] = useState(false);
  const [recommendation, setRecommendation] = useState<EnhancementRecommendation | null>(null);
  const [recommendLanguage, setRecommendLanguage] = useState<"he" | "auto">("he");
  const [compareTrack, setCompareTrack] = useState<"original" | "enhanced">("enhanced");
  const originalCompareRef = useRef<HTMLAudioElement>(null);
  const enhancedCompareRef = useRef<HTMLAudioElement>(null);

  const switchTrack = useCallback((track: "original" | "enhanced") => {
    const from = track === "original" ? enhancedCompareRef.current : originalCompareRef.current;
    const to = track === "original" ? originalCompareRef.current : enhancedCompareRef.current;
    if (from && to) {
      to.currentTime = from.currentTime;
      if (!from.paused) {
        from.pause();
        void to.play();
      }
    }
    setCompareTrack(track);
  }, []);

  useEffect(() => {
    setOutputFormat(defaultOutputFormat);
  }, [defaultOutputFormat, open]);

  useEffect(() => {
    setEnhancedFile((prev) => {
      if (prev) {
        // no-op; URL cleanup handled separately
      }
      return null;
    });
    setEnhancedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [file, preset, outputFormat, open]);

  useEffect(() => {
    if (!open || !file) {
      setSourceDurationSec(null);
      return;
    }
    probeAudioDurationSec(file)
      .then((d) => setSourceDurationSec(d))
      .catch(() => setSourceDurationSec(null));
  }, [open, file]);

  useEffect(() => {
    if (!file || !open) {
      setAudioUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }

    const nextUrl = URL.createObjectURL(file);
    setAudioUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return nextUrl;
    });

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [file, open]);

  const title = useMemo(() => {
    if (sourceLabel?.trim()) return sourceLabel.trim();
    return file?.name || "קובץ אודיו";
  }, [file?.name, sourceLabel]);

  const handleDownload = () => {
    if (!audioUrl || !file) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = file.name;
    a.click();
  };

  const handleDownloadEnhanced = () => {
    if (!enhancedUrl || !enhancedFile) return;
    const a = document.createElement("a");
    a.href = enhancedUrl;
    a.download = enhancedFile.name;
    a.click();
  };

  const runEnhancement = async (opts: {
    downloadAfter?: boolean;
    transcribeAfter?: boolean;
    forceFullScope?: boolean;
    presetOverride?: EnhancementPreset;
  }) => {
    if (!file) return;
    setIsEnhancing(true);
    try {
      const inputFile = await (async () => {
        if (opts.forceFullScope || scopeMode === "full") return file;
        const start = Math.max(0, Number(partStartSec) || 0);
        const duration = Math.max(5, Number(partDurationSec) || 120);
        return extractAudioSegment(file, start, start + duration);
      })();

      const result = await enhanceAudioOnServer(inputFile, {
        preset: opts.presetOverride || preset,
        outputFormat,
      });
      const nextFile = new File([result.blob], result.fileName, { type: result.mimeType });
      const nextUrl = URL.createObjectURL(nextFile);

      setEnhancedFile(nextFile);
      setEnhancedUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });

      toast({ title: "הקובץ שופר בהצלחה ✓", description: `${nextFile.name} (${formatBytes(nextFile.size)})` });

      if (opts.downloadAfter) {
        const a = document.createElement("a");
        a.href = nextUrl;
        a.download = nextFile.name;
        a.click();
      }

      if (opts.transcribeAfter && onTranscribe) {
        onTranscribe(nextFile);
        onOpenChange(false);
      }
    } catch (err: any) {
      toast({
        title: "שיפור הקובץ נכשל",
        description: err?.message || "תקלה לא ידועה",
        variant: "destructive",
      });
    } finally {
      setIsEnhancing(false);
    }
  };

  const enqueueEnhancement = () => {
    if (!file) return;
    if (scopeMode === "part") {
      toast({
        title: "תור רקע תומך בקובץ מלא",
        description: "לשיפור חלקי השתמש בכפתור שפר בלבד/שפר+שמור",
      });
      return;
    }
    submitEnhanceJob(file, { preset, outputFormat });
    toast({ title: "נוסף לתור שיפור רקע", description: `${file.name} • ${preset === "ai_voice" ? "AI Voice" : "Auto EQ"}` });
  };

  const runRecommendation = async () => {
    if (!file) return;
    setIsRecommending(true);
    setRecommendation(null);
    try {
      const inputFile = scopeMode === "full"
        ? file
        : await extractAudioSegment(
            file,
            Math.max(0, Number(partStartSec) || 0),
            Math.max(0, Number(partStartSec) || 0) + Math.max(5, Number(partDurationSec) || 120),
          );

      const rec = await recommendEnhancementForTranscription(inputFile, {
        language: recommendLanguage,
        outputFormat,
      });
      setRecommendation(rec);
      setPreset(rec.bestPreset);
      toast({
        title: "התקבלה המלצה מקצועית",
        description: `המלצה לתמלול: ${rec.bestPreset.toUpperCase()}`,
      });
    } catch (err: any) {
      toast({
        title: "ניתוח והמלצה נכשלו",
        description: err?.message || "תקלה לא ידועה",
        variant: "destructive",
      });
    } finally {
      setIsRecommending(false);
    }
  };

  const downloadRecommendationReport = (format: "json" | "txt") => {
    if (!recommendation || !file) return;

    const timestamp = new Date().toISOString();
    const safeBaseName = file.name.replace(/\.[^/.]+$/, "");
    const reportBase = `${safeBaseName}.transcription-recommendation.${timestamp.replace(/[:.]/g, "-")}`;

    const payload = {
      generatedAt: timestamp,
      sourceFile: file.name,
      sourceSizeBytes: file.size,
      scopeMode,
      scope:
        scopeMode === "full"
          ? { type: "full" as const }
          : {
              type: "part" as const,
              startSec: Math.max(0, Number(partStartSec) || 0),
              durationSec: Math.max(5, Number(partDurationSec) || 120),
            },
      language: recommendLanguage,
      outputFormat,
      bestPreset: recommendation.bestPreset,
      rationale: recommendation.rationale,
      baseline: recommendation.baseline,
      candidates: recommendation.rows,
    };

    const textBody = [
      "דוח המלצת שיפור לתמלול",
      `נוצר בתאריך: ${timestamp}`,
      `קובץ: ${file.name}`,
      `שפה: ${recommendLanguage}`,
      `פורמט יעד: ${outputFormat}`,
      `טווח: ${scopeMode === "full" ? "קובץ מלא" : `חלקי (התחלה ${partStartSec}s, משך ${partDurationSec}s)`}`,
      "",
      `המלצה: ${recommendation.bestPreset.toUpperCase()}`,
      `נימוק: ${recommendation.rationale}`,
      "",
      `בסיס - מילים: ${recommendation.baseline.wordCount}, ביטחון: ${(recommendation.baseline.avgProbability * 100).toFixed(1)}%, זמן: ${recommendation.baseline.processingTimeSec.toFixed(1)}s`,
      "",
      "מועמדים:",
      ...recommendation.rows.map(
        (r) =>
          `- ${r.preset.toUpperCase()} | ציון ${r.score.toFixed(2)} | מילים ${r.wordCount} | ביטחון ${(r.avgProbability * 100).toFixed(1)}% | זמן ${r.processingTimeSec.toFixed(1)}s`,
      ),
    ].join("\n");

    const blob =
      format === "json"
        ? new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" })
        : new Blob([textBody], { type: "text/plain;charset=utf-8" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportBase}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            שיפור איכות קובץ קולי
          </DialogTitle>
          <DialogDescription className="text-right">
            <span className="font-medium">{title}</span>
            {file && <span className="text-muted-foreground"> ({formatBytes(file.size)})</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">AI Voice</Badge>
            <Badge variant="outline">אקולייזרים אוטומטיים</Badge>
            <Badge variant="outline">מצב ידני מתקדם</Badge>
            <Badge variant="outline">ללא AI (פריסטים רגילים)</Badge>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">מצב שיפור</p>
            <p className="text-[11px] text-muted-foreground mb-1">פריסטים קלאסיים (FFmpeg)</p>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_OPTIONS.filter((p) => p.group === "classic").map((p) => (
                <Button
                  key={p.id}
                  variant={preset === p.id ? "default" : "outline"}
                  size="sm"
                  className="justify-start"
                  onClick={() => setPreset(p.id)}
                >
                  {p.label}
                  <span className="mr-2 text-[10px] opacity-80">Auto</span>
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3 mb-1">🧠 שיפור AI (רשת נוירונית — GPU)</p>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_OPTIONS.filter((p) => p.group === "ai").map((p) => (
                <Button
                  key={p.id}
                  variant={preset === p.id ? "default" : "outline"}
                  size="sm"
                  className="justify-start"
                  onClick={() => setPreset(p.id)}
                >
                  {p.label}
                  <span className="mr-2 text-[10px] opacity-80">AI</span>
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {PRESET_OPTIONS.find((p) => p.id === preset)?.description}
            </p>
          </div>

          <div className="space-y-2 border rounded-lg p-3 bg-muted/10">
            <p className="text-sm font-medium">שיפור לתמלול: קובץ מלא או חלקי</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={scopeMode === "full" ? "default" : "outline"} onClick={() => setScopeMode("full")}>קובץ מלא</Button>
              <Button size="sm" variant={scopeMode === "part" ? "default" : "outline"} onClick={() => setScopeMode("part")}>רק חלק לבדיקה</Button>
            </div>
            {scopeMode === "part" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">התחלה (שניות)</p>
                  <input className="w-full h-8 rounded border bg-background px-2 text-sm" value={partStartSec} onChange={(e) => setPartStartSec(e.target.value)} />
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground mb-1">משך (שניות)</p>
                  <input className="w-full h-8 rounded border bg-background px-2 text-sm" value={partDurationSec} onChange={(e) => setPartDurationSec(e.target.value)} />
                </div>
                <div className="text-[11px] text-muted-foreground self-end">
                  משך קובץ: {sourceDurationSec ? `${sourceDurationSec.toFixed(1)}s` : "לא זוהה"}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2 border rounded-lg p-3 bg-primary/5">
            <p className="text-sm font-medium">המלצה אוטומטית מקצועית לתמלול</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={recommendLanguage === "he" ? "default" : "outline"} onClick={() => setRecommendLanguage("he")}>עברית</Button>
              <Button size="sm" variant={recommendLanguage === "auto" ? "default" : "outline"} onClick={() => setRecommendLanguage("auto")}>זיהוי אוטומטי</Button>
              <Button size="sm" className="gap-2" onClick={() => void runRecommendation()} disabled={!file || isEnhancing || isRecommending}>
                {isRecommending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                נתח והמלץ
              </Button>
            </div>
            {recommendation && (
              <div className="space-y-2 text-xs">
                <p className="font-medium text-foreground">{recommendation.rationale}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={!file || isEnhancing}
                    onClick={() =>
                      void runEnhancement({
                        presetOverride: recommendation.bestPreset,
                        forceFullScope: true,
                        transcribeAfter: true,
                      })
                    }
                  >
                    {isEnhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                    החל המלצה על קובץ מלא + תמלל
                  </Button>
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => downloadRecommendationReport("json")}>
                    <Download className="w-4 h-4" />
                    יצוא דוח JSON
                  </Button>
                  <Button size="sm" variant="outline" className="gap-2" onClick={() => downloadRecommendationReport("txt")}>
                    <Download className="w-4 h-4" />
                    יצוא דוח TXT
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {recommendation.rows.map((r) => (
                    <div key={r.preset} className="rounded border px-2 py-1.5 bg-background/70">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{r.preset.toUpperCase()}</span>
                        <span>ציון {r.score.toFixed(2)}</span>
                      </div>
                      <div className="text-muted-foreground mt-1">
                        מילים: {r.wordCount} • ביטחון: {(r.avgProbability * 100).toFixed(1)}% • זמן: {r.processingTimeSec.toFixed(1)}s
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">פורמט פלט משופר</p>
            <div className="flex flex-wrap gap-2">
              {OUTPUT_OPTIONS.map((o) => (
                <Button
                  key={o.id}
                  variant={outputFormat === o.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setOutputFormat(o.id)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          </div>

          <SyncAudioPlayer audioUrl={audioUrl} wordTimings={[]} compact />

          {enhancedUrl && enhancedFile && (
            <div className="space-y-3 border-2 rounded-lg p-4 bg-muted/20 border-primary/30">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-bold flex items-center gap-2">
                  🔀 השוואה: לפני ← אחרי
                </p>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(file!.size)} → {formatBytes(enhancedFile.size)}
                  {file && enhancedFile.size < file.size && (
                    <span className="text-green-600 mr-1">
                      {" "}(−{((1 - enhancedFile.size / file.size) * 100).toFixed(0)}%)
                    </span>
                  )}
                </span>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={compareTrack === "original" ? "default" : "outline"}
                  className="flex-1 gap-2"
                  onClick={() => switchTrack("original")}
                >
                  🅰️ מקור
                </Button>
                <Button
                  size="sm"
                  variant={compareTrack === "enhanced" ? "default" : "outline"}
                  className="flex-1 gap-2"
                  onClick={() => switchTrack("enhanced")}
                >
                  🅱️ משופר
                </Button>
              </div>

              <div>
                <audio
                  ref={originalCompareRef}
                  src={audioUrl!}
                  controls
                  className={`w-full ${compareTrack !== "original" ? "hidden" : ""}`}
                />
                <audio
                  ref={enhancedCompareRef}
                  src={enhancedUrl}
                  controls
                  className={`w-full ${compareTrack !== "enhanced" ? "hidden" : ""}`}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {onTranscribe && (
                  <Button size="sm" className="gap-2" onClick={() => { onTranscribe(enhancedFile); onOpenChange(false); }}>
                    <Mic className="w-4 h-4" />
                    אשר ותמלל
                  </Button>
                )}
                <Button size="sm" variant="outline" className="gap-2" onClick={handleDownloadEnhanced}>
                  <Download className="w-4 h-4" />
                  הורד משופר
                </Button>
                <Button size="sm" variant="outline" className="gap-2" onClick={handleDownload}>
                  <Download className="w-4 h-4" />
                  הורד מקור
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="gap-2"
                  onClick={() => {
                    setEnhancedFile(null);
                    setEnhancedUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
                    setCompareTrack("enhanced");
                  }}
                >
                  ❌ בטל שיפור
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          <Button
            className="gap-2 w-full"
            disabled={!file || isEnhancing}
            onClick={() => void runEnhancement({ transcribeAfter: true })}
          >
            {isEnhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            שפר + תמלל
          </Button>
          <Button
            variant="secondary"
            className="gap-2 w-full"
            disabled={!file || isEnhancing}
            onClick={() => void runEnhancement({ downloadAfter: true })}
          >
            {isEnhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            שפר + שמור
          </Button>
          <Button
            variant="outline"
            className="gap-2 w-full"
            disabled={!file || isEnhancing}
            onClick={() => void runEnhancement({})}
          >
            {isEnhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            שפר בלבד
          </Button>
          <Button
            variant="outline"
            className="gap-2 w-full"
            disabled={!file || isEnhancing}
            onClick={() => enqueueEnhancement()}
          >
            <Sparkles className="w-4 h-4" />
            הוסף לתור רקע
          </Button>
          {onTranscribe && file && (
            <Button
              variant="ghost"
              className="gap-2 w-full"
              onClick={() => {
                onTranscribe(file);
                onOpenChange(false);
              }}
            >
              <Mic className="w-4 h-4" />
              תמלל מקור
            </Button>
          )}
          <Button variant="ghost" className="gap-2 w-full" onClick={handleDownload} disabled={!file || !audioUrl}>
            <Download className="w-4 h-4" />
            שמור מקור
          </Button>
          <Button variant="outline" className="gap-2 w-full" onClick={handleDownloadEnhanced} disabled={!enhancedFile || !enhancedUrl}>
            <Download className="w-4 h-4" />
            הורד משופר
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
