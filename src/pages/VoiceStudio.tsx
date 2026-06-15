import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  clearEnhanceQueueCompleted,
  getEnhanceQueueJobs,
  onEnhanceQueueUpdate,
  removeEnhanceQueueJob,
  type EnhanceQueueJob,
} from "@/lib/audioEnhanceQueue";
import AudioEnhanceDialog from "@/components/AudioEnhanceDialog";
import { toast } from "@/hooks/use-toast";
import {
  AudioLines,
  Download,
  FileAudio,
  FileStack,
  FolderOpen,
  FolderUp,
  LayoutGrid,
  Loader2,
  Mic,
  Scissors,
  Sparkles,
  TestTube2,
  Trash2,
  UploadCloud,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { LazyErrorBoundary } from "@/components/LazyErrorBoundary";
import EnhanceCompare from "@/components/EnhanceCompare";

const SyncAudioPlayer = lazy(() => import("@/components/SyncAudioPlayer").then(m => ({ default: m.SyncAudioPlayer })));

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function VoiceStudio() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [enhanceDialogOpen, setEnhanceDialogOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [enhanceQueueJobs, setEnhanceQueueJobs] = useState<EnhanceQueueJob[]>(() => getEnhanceQueueJobs());
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!folderInputRef.current) return;
    folderInputRef.current.setAttribute("webkitdirectory", "");
    folderInputRef.current.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    return onEnhanceQueueUpdate((jobs) => {
      setEnhanceQueueJobs(jobs);
    });
  }, []);

  // Create object URL when sourceFile changes
  useEffect(() => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (sourceFile) {
      const url = URL.createObjectURL(sourceFile);
      audioUrlRef.current = url;
      setAudioUrl(url);
    } else {
      setAudioUrl(null);
    }
    return () => {
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, [sourceFile]);

  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSourceFile(file);
    setSelectedFiles(file ? [file] : []);
    e.target.value = "";
  }, []);

  const onPickManyFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSelectedFiles(files);
    setSourceFile(files[0]);
    toast({
      title: "נטענו קבצים לסטודיו",
      description: `${files.length} קבצים מוכנים לעבודה`,
    });
    e.target.value = "";
  }, []);

  const onPickFolder = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSelectedFiles(files);
    setSourceFile(files[0]);
    toast({
      title: "תיקיה נטענה בהצלחה",
      description: `${files.length} קבצים נמצאו בתיקיה`,
    });
    e.target.value = "";
  }, []);

  const onDropFiles = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) {
      toast({
        title: "לא נמצאו קבצים בגרירה",
        description: "נסה לגרור קבצי אודיו/וידאו או לבחור תיקיה מכפתור בחירה",
        variant: "destructive",
      });
      return;
    }

    setSelectedFiles(files);
    setSourceFile(files[0]);
  }, []);

  const openFolderPicker = useCallback(() => {
    folderInputRef.current?.click();
  }, []);

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

  const queueStats = useMemo(() => {
    return {
      total: enhanceQueueJobs.length,
      active: enhanceQueueJobs.filter((j) => j.status === "enhancing").length,
      queued: enhanceQueueJobs.filter((j) => j.status === "queued").length,
      done: enhanceQueueJobs.filter((j) => j.status === "done").length,
      errors: enhanceQueueJobs.filter((j) => j.status === "error").length,
    };
  }, [enhanceQueueJobs]);

  const selectedTotalBytes = useMemo(
    () => selectedFiles.reduce((sum, f) => sum + f.size, 0),
    [selectedFiles]
  );

  return (
    <div className="w-full max-w-full px-4 py-6 space-y-6" dir="rtl">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-l from-primary/10 via-background to-amber-50/70 p-5">
        <div className="absolute -top-10 -left-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-10 -right-10 h-36 w-36 rounded-full bg-amber-300/20 blur-3xl" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <AudioLines className="w-7 h-7 text-primary" />
              סטודיו קול
            </h1>
            <p className="text-sm md:text-base text-muted-foreground mt-1 max-w-3xl">
              סביבת עבודה מתקדמת לשיפור איכות תמלול: הפחתת רעש, אקולייזר, מיקסר מקצועי ופריסטים חכמים.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1"><WandSparkles className="w-3.5 h-3.5" /> AI + Auto EQ</Badge>
            <Badge variant="outline">Real-time Filters</Badge>
            <Badge variant="outline">Batch Queue</Badge>
          </div>
        </div>
      </div>

      <Tabs defaultValue="enhance" className="space-y-4" dir="rtl">
        <TabsList className="h-auto p-1.5 rounded-xl bg-muted/60 border flex flex-wrap justify-start gap-1">
          <TabsTrigger value="enhance" className="rounded-lg data-[state=active]:shadow-sm">שיפור וטעינה</TabsTrigger>
          <TabsTrigger value="compare" className="rounded-lg data-[state=active]:shadow-sm gap-1"><Zap className="w-3.5 h-3.5" />השוואת מנועים</TabsTrigger>
          <TabsTrigger value="batch" className="rounded-lg data-[state=active]:shadow-sm">קבצים ותיקיות</TabsTrigger>
          <TabsTrigger value="flows" className="rounded-lg data-[state=active]:shadow-sm">זרימות עבודה</TabsTrigger>
        </TabsList>

        <TabsContent value="enhance" className="mt-0 space-y-5">
          {/* File Upload Section — compact when file loaded */}
          <Card className="border-2 border-primary/10 shadow-sm">
            <CardContent className="p-4 space-y-3">
              {!sourceFile ? (
                <>
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-sm">שיפור קובץ בקליק</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    גרור קובץ או תיקיה לאזור למטה, או בחר ידנית. הנגן המקצועי עם כל כלי העיבוד ייפתח מיד.
                  </p>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
                    onDrop={onDropFiles}
                    className={`rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                      dragActive
                        ? "border-primary bg-primary/10 scale-[1.01]"
                        : "border-border bg-muted/20 hover:border-primary/50 hover:bg-muted/40"
                    }`}
                  >
                    <UploadCloud className="w-10 h-10 mx-auto mb-3 text-primary" />
                    <p className="text-sm font-medium">גרור לכאן קבצי אודיו/וידאו או תיקיה שלמה</p>
                    <p className="text-xs text-muted-foreground mt-1">תומך גם בבחירה מרובה ובתיקיות (Chrome/Edge)</p>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileAudio className="w-4 h-4 text-primary shrink-0" />
                    <span className="text-sm font-medium truncate">{sourceFile.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatBytes(sourceFile.size)}</span>
                    {selectedFiles.length > 1 && (
                      <Badge variant="outline" className="text-[10px] shrink-0">{selectedFiles.length} קבצים</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setEnhanceDialogOpen(true)}>
                      <Sparkles className="w-3.5 h-3.5" />
                      שיפור מתקדם
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => navigate("/transcribe", { state: { file: sourceFile } })}>
                      <Mic className="w-3.5 h-3.5" />
                      תמלל
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setSourceFile(null); setSelectedFiles([]); }}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button className="gap-2" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <FileAudio className="w-3.5 h-3.5" />
                  בחר קובץ
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                  <LayoutGrid className="w-3.5 h-3.5" />
                  בחר כמה קבצים
                </Button>
                <Button variant="outline" size="sm" className="gap-2" onClick={openFolderPicker}>
                  <FolderUp className="w-3.5 h-3.5" />
                  בחר תיקיה
                </Button>
                <Input ref={fileInputRef} type="file" accept="audio/*,video/*" multiple className="hidden" onChange={onPickManyFiles} />
                <Input ref={folderInputRef} type="file" multiple className="hidden" onChange={onPickFolder} />
              </div>
            </CardContent>
          </Card>

          {/* ═══ INLINE PLAYER WITH FULL MIXER ═══ */}
          {sourceFile && audioUrl && (
            <div className="rounded-2xl border border-border/40 bg-card/50 shadow-sm p-1">
              <LazyErrorBoundary label="נגן סטודיו">
                <Suspense fallback={<div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>}>
                  <SyncAudioPlayer
                    audioUrl={audioUrl}
                    wordTimings={[]}
                    currentTime={0}
                    onTimeUpdate={() => {}}
                  />
                </Suspense>
              </LazyErrorBoundary>
            </div>
          )}
        </TabsContent>

        <TabsContent value="compare" className="mt-0">
          <EnhanceCompare />
        </TabsContent>

        <TabsContent value="batch" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-primary" />
                קבצים ותיקיות לטעינה
              </CardTitle>
              <CardDescription>
                תצוגה מרוכזת של כל הפריטים שנקלטו. בחר פריט ולחץ על שיפור כדי לעבור לחלון AI.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedFiles.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  אין פריטים עדיין. עבור ללשונית "שיפור וטעינה" כדי לגרור קבצים/תיקיות.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                    <span>{selectedFiles.length} פריטים</span>
                    <span className="text-muted-foreground">סה"כ {formatBytes(selectedTotalBytes)}</span>
                  </div>
                  <div className="max-h-[320px] overflow-auto space-y-2 pr-1">
                    {selectedFiles.map((file, idx) => (
                      <button
                        key={`${file.name}-${idx}`}
                        type="button"
                        onClick={() => setSourceFile(file)}
                        className={`w-full text-right rounded-lg border px-3 py-2 transition-colors ${
                          sourceFile?.name === file.name && sourceFile?.size === file.size
                            ? "border-primary bg-primary/10"
                            : "hover:bg-muted/40"
                        }`}
                      >
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-[11px] text-muted-foreground">{formatBytes(file.size)}</p>
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button className="gap-2" disabled={!sourceFile} onClick={() => setEnhanceDialogOpen(true)}>
                      <Sparkles className="w-4 h-4" />
                      שפר את הפריט הנבחר
                    </Button>
                    <Button variant="outline" className="gap-2" disabled={!sourceFile} onClick={() => sourceFile && navigate("/transcribe", { state: { file: sourceFile } })}>
                      <Mic className="w-4 h-4" />
                      תמלל את הפריט הנבחר
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="flows" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileStack className="w-4 h-4 text-primary" />
                זרימות עבודה
              </CardTitle>
              <CardDescription>מעבר מהיר לכלים המתקדמים שכבר קיימים במערכת.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Button variant="outline" className="w-full justify-between" onClick={() => navigate("/video-to-mp3")}>ממיר + חיתוך + שיפור <Scissors className="w-4 h-4" /></Button>
              <Button variant="outline" className="w-full justify-between" onClick={() => navigate("/benchmark")}>בדיקת איכות תמלול (A/B) <TestTube2 className="w-4 h-4" /></Button>
              <Button variant="outline" className="w-full justify-between" onClick={() => navigate("/transcribe")}>תמלול מיידי מקובץ <Mic className="w-4 h-4" /></Button>
              <Button variant="outline" className="w-full justify-between" onClick={() => navigate("/text-editor")}>עריכה + פילטרים בזמן אמת <AudioLines className="w-4 h-4" /></Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Enhancement Queue */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              תור שיפור רקע ({queueStats.total})
            </span>
            <div className="flex items-center gap-1">
              {queueStats.active > 0 && (
                <Badge variant="default" className="text-[10px] gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {queueStats.active} פעילים
                </Badge>
              )}
              {queueStats.queued > 0 && <Badge variant="outline" className="text-[10px]">{queueStats.queued} בתור</Badge>}
              {(queueStats.done > 0 || queueStats.errors > 0) && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={clearEnhanceQueueCompleted}>
                  נקה הסתיימו
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {enhanceQueueJobs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              אין כרגע משימות בתור. אפשר להוסיף מתפריט השיפור של קובץ.
            </div>
          ) : (
            <div className="space-y-2">
              {enhanceQueueJobs.slice(0, 20).map((job) => (
                <div key={job.id} className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{job.sourceName}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.preset === "ai_voice" ? "AI Voice" : "Auto EQ"} • {job.outputFormat.toUpperCase()}
                      {job.error ? ` • ${job.error}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {job.status === "queued" && <Badge variant="outline" className="text-[10px]">בתור</Badge>}
                    {job.status === "enhancing" && (
                      <Badge variant="default" className="text-[10px] gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        משפר
                      </Badge>
                    )}
                    {job.status === "error" && <Badge variant="destructive" className="text-[10px]">שגיאה</Badge>}
                    {job.status === "done" && (
                      <>
                        <Badge variant="secondary" className="text-[10px]">הושלם</Badge>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleTranscribeEnhancedQueueJob(job)}>
                          <Mic className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleDownloadEnhancedQueueJob(job)}>
                          <Download className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                    {job.status !== "enhancing" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeEnhanceQueueJob(job.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Keep dialog for advanced enhancement (server-side processing) */}
      <AudioEnhanceDialog
        open={enhanceDialogOpen}
        onOpenChange={(open) => {
          setEnhanceDialogOpen(open);
        }}
        file={sourceFile}
        onTranscribe={(file) => navigate("/transcribe", { state: { file } })}
      />
    </div>
  );
}
