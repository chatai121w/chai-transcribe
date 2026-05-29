import { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, Loader2, Zap, Globe, Chrome, Mic, Waves, Server, Cpu, Film, Music, FolderUp, Files, Play, X, CheckCircle, AlertCircle, RotateCcw, Clock, FileAudio } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { isVideoFile } from "@/lib/videoUtils";
import { toast } from "@/hooks/use-toast";
import type { TranscriptionJob } from "@/hooks/useTranscriptionJobs";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function UploadProgressBar({ progress, fileName, fileSize, statusText }: { progress?: number; fileName?: string; fileSize?: number; statusText?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const iv = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const pct = progress !== undefined && progress > 0 ? progress : 0;
  const hasProgress = pct > 0;

  return (
    <div className="w-full space-y-2 p-3 rounded-lg bg-muted/40 border border-border/50">
      {/* Top row: file info + elapsed */}
      <div className="flex items-center justify-between text-xs text-muted-foreground" dir="rtl">
        <div className="flex items-center gap-1.5 truncate max-w-[70%]">
          <FileAudio className="w-3.5 h-3.5 shrink-0" />
          {fileName && <span className="truncate font-medium">{fileName}</span>}
          {fileSize && <span className="text-[10px]">({formatBytes(fileSize)})</span>}
        </div>
        <div className="flex items-center gap-1 font-mono tabular-nums">
          <Clock className="w-3 h-3" />
          <span>{mm}:{ss}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative h-3 rounded-full bg-muted overflow-hidden">
        {hasProgress ? (
          <div
            className="absolute top-0 right-0 h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(pct, 3)}%` }}
          >
            <div className="absolute top-0 left-0 h-full w-6 bg-white/30 animate-pulse rounded-full" />
          </div>
        ) : (
          <div className="absolute inset-0 rounded-full overflow-hidden">
            <div className="h-full w-full bg-primary/20 rounded-full" />
            <div
              className="absolute top-0 h-full w-1/3 bg-primary/50 rounded-full"
              style={{ animation: 'transcription-scan 1.6s ease-in-out infinite' }}
            />
          </div>
        )}
      </div>

      {/* Bottom row: percentage */}
      <div className="flex items-center justify-between text-xs" dir="rtl">
        <span className="font-medium text-primary">
          {hasProgress ? `${pct}%` : (statusText || 'מעבד...')}
        </span>
        {hasProgress && pct < 100 && elapsed > 3 && (
          <span className="text-muted-foreground text-[11px]">
            נותרו ~{(() => {
              const etaSec = Math.max(1, Math.round((elapsed / pct) * (100 - pct)));
              const etaMin = Math.floor(etaSec / 60);
              const etaSecRem = etaSec % 60;
              return etaMin > 0 ? `${etaMin}:${String(etaSecRem).padStart(2, '0')}` : `${etaSecRem}s`;
            })()}
          </span>
        )}
      </div>
    </div>
  );
}

const ENGINE_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  groq: { label: 'Groq', icon: <Zap className="w-3 h-3" />, color: 'text-primary' },
  openai: { label: 'OpenAI', icon: <Globe className="w-3 h-3" />, color: 'text-primary' },
  google: { label: 'Google', icon: <Chrome className="w-3 h-3" />, color: 'text-blue-500' },
  assemblyai: { label: 'AssemblyAI', icon: <Mic className="w-3 h-3" />, color: 'text-green-500' },
  deepgram: { label: 'Deepgram', icon: <Waves className="w-3 h-3" />, color: 'text-purple-500' },
  'local-server': { label: 'CUDA', icon: <Server className="w-3 h-3" />, color: 'text-purple-500' },
  local: { label: 'ONNX', icon: <Cpu className="w-3 h-3" />, color: 'text-accent' },
};

function isAudioOrVideo(file: File): boolean {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return true;
  const ext = file.name.toLowerCase().split(".").pop() || "";
  return ["mp3","wav","m4a","ogg","flac","aac","wma","opus","mp4","webm","avi","mov","mkv","wmv","amr","3gp","3gpp","aiff","aif","caf","spx","gsm"].includes(ext);
}

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
  progress?: number;
  engine?: string;
  statusText?: string;
  // Batch/background props (cloud engines only)
  isAuthenticated?: boolean;
  isCloudEngine?: boolean;
  onSubmitBatch?: (files: File[]) => Promise<string[]>;
  onSaveTranscript?: (text: string, engine: string, title: string) => Promise<void>;
  onRetryJob?: (jobId: string) => Promise<void>;
  onSubmitBackgroundJob?: (file: File) => Promise<string | null>;
  jobs?: TranscriptionJob[];
  maxFileSizeMB?: number;
}

export const FileUploader = ({
  onFileSelect, isLoading, progress, engine, statusText,
  isAuthenticated, isCloudEngine,
  onSubmitBatch, onSaveTranscript, onRetryJob, onSubmitBackgroundJob,
  jobs = [], maxFileSizeMB = 500,
}: FileUploaderProps) => {
  const meta = engine ? ENGINE_META[engine] : null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Clear selectedFile when transcription ends (success or failure)
  const prevLoadingRef = useRef(isLoading);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      // Transcription just finished — reset file input and selected file
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading]);

  // Batch state
  const [pendingBatchFiles, setPendingBatchFiles] = useState<File[]>([]);
  const [submittedJobIds, setSubmittedJobIds] = useState<Set<string>>(new Set());
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const showBatch = (isAuthenticated && isCloudEngine && !!onSubmitBatch) || engine === 'local-server';
  const batchJobs = jobs.filter(j => submittedJobIds.has(j.id));

  // Auto-save completed batch jobs
  useEffect(() => {
    if (!onSaveTranscript) return;
    batchJobs.forEach(job => {
      if (job.status === 'completed' && job.result_text && !savedJobIds.has(job.id)) {
        setSavedJobIds(prev => {
          const next = new Set(prev);
          next.add(job.id);
          return next;
        });
        const title = job.file_name?.replace(/\.[^/.]+$/, "") || "תמלול";
        onSaveTranscript(job.result_text, job.engine, title);
      }
    });
  }, [batchJobs, savedJobIds, onSaveTranscript]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > maxFileSizeMB * 1024 * 1024) {
        toast({ title: `הקובץ גדול מדי (${Math.round(file.size / 1024 / 1024)}MB)`, description: `הגבלה: ${maxFileSizeMB}MB`, variant: "destructive" });
        e.target.value = '';
        return;
      }
      setSelectedFile(file);
      onFileSelect(file);
      // Reset input value so the same file can be re-selected
      e.target.value = '';
    }
  };

  const addBatchFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const audioFiles = Array.from(fileList).filter(isAudioOrVideo);
    if (audioFiles.length === 0) return;
    setPendingBatchFiles(prev => [...prev, ...audioFiles]);
  }, []);

  const removeBatchFile = (index: number) => {
    setPendingBatchFiles(prev => prev.filter((_, i) => i !== index));
  };

  const startBatchProcessing = async () => {
    if (isSubmitting || pendingBatchFiles.length === 0) return;
    setIsSubmitting(true);

    // Cloud batch: submit all at once via onSubmitBatch
    if (onSubmitBatch) {
      const ids = await onSubmitBatch(pendingBatchFiles);
      setSubmittedJobIds(prev => {
        const next = new Set(prev);
        ids.forEach(id => next.add(id));
        return next;
      });
      setPendingBatchFiles([]);
      setIsSubmitting(false);
      return;
    }

    // Local-server batch: process files one by one via onFileSelect
    const files = [...pendingBatchFiles];
    setPendingBatchFiles([]);
    for (const file of files) {
      onFileSelect(file);
      // Wait for current transcription to finish before sending next
      await new Promise<void>(resolve => {
        const check = () => {
          // Poll isLoading state — when it goes false, the job is done
          setTimeout(() => {
            const still = document.querySelector('[data-transcribing="true"]');
            if (still) check();
            else resolve();
          }, 1000);
        };
        // Give time for onFileSelect to set isLoading=true
        setTimeout(check, 2000);
      });
    }
    setIsSubmitting(false);
  };

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(isAudioOrVideo);
    if (droppedFiles.length === 0) return;

    if (droppedFiles.length === 1) {
      // Single file → immediate transcription
      setSelectedFile(droppedFiles[0]);
      onFileSelect(droppedFiles[0]);
    } else if (showBatch) {
      // Multiple files → add to batch queue
      setPendingBatchFiles(prev => [...prev, ...droppedFiles]);
    } else {
      // No batch available, just use first file
      setSelectedFile(droppedFiles[0]);
      onFileSelect(droppedFiles[0]);
    }
  }, [onFileSelect, showBatch]);

  const isVideo = selectedFile ? isVideoFile(selectedFile) : false;
  const completedCount = batchJobs.filter(j => j.status === "completed").length;
  const failedCount = batchJobs.filter(j => j.status === "failed").length;
  const totalBatch = batchJobs.length;
  const overallProgress = totalBatch > 0
    ? Math.round(batchJobs.reduce((sum, j) => sum + (j.progress || 0), 0) / totalBatch)
    : 0;

  return (
    <Card
      className={`p-6 transition-colors ${isDragOver ? 'border-primary bg-primary/5 border-2 border-dashed' : ''}`}
      dir="rtl"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex flex-col gap-4">
        {/* Header row with engine badge */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {isLoading ? "מתמלל..." : "העלה קובץ אודיו או וידאו"}
          </h3>
          <div className="flex items-center gap-2">
            {meta && (
              <Badge variant="outline" className={`flex items-center gap-1 text-[10px] px-2 py-0.5 ${meta.color}`}>
                {meta.icon}
                {meta.label}
              </Badge>
            )}
            {isVideo && isLoading && (
              <Badge className="flex items-center gap-1 text-[10px] bg-purple-600 hover:bg-purple-700">
                <Film className="w-3 h-3" />
                וידאו — מחלץ אודיו
              </Badge>
            )}
          </div>
        </div>

        {/* Drop zone */}
        <div
          className={`flex flex-col items-center gap-3 py-6 rounded-lg border-2 border-dashed transition-colors cursor-pointer ${
            isDragOver ? 'border-primary bg-primary/10' : 'border-muted-foreground/20 hover:border-primary/40'
          }`}
          onClick={() => !isLoading && fileInputRef.current?.click()}
        >
          <div className="rounded-full bg-primary/10 p-4">
            {isLoading ? (
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            ) : isVideo ? (
              <Film className="w-8 h-8 text-purple-500" />
            ) : (
              <Upload className="w-8 h-8 text-primary" />
            )}
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">
              {isDragOver ? 'שחרר כאן' : 'גרור קובץ לכאן או לחץ לבחירה'}
            </p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap justify-center">
              <span className="flex items-center gap-1"><Music className="w-3 h-3" /> MP3, WAV, M4A, FLAC, OGG, AAC, WMA</span>
              <span className="flex items-center gap-1"><Film className="w-3 h-3" /> MP4, WEBM, AVI, MOV, MKV</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              עד {maxFileSizeMB}MB — קבצים גדולים יכווצו אוטומטית
            </p>
          </div>
        </div>

        {/* Progress bar with elapsed time */}
        {isLoading && (
          <UploadProgressBar progress={progress} fileName={selectedFile?.name} fileSize={selectedFile?.size} statusText={statusText} />
        )}

        {/* Action buttons row */}
        <div className="flex flex-wrap gap-2 items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,video/*,.mp3,.wav,.m4a,.flac,.ogg,.opus,.aac,.wma,.amr,.mp4,.webm,.avi,.mov,.mkv,.wmv,.3gp,.3gpp,.aiff,.aif,.caf,.spx,.gsm"
            onChange={handleFileChange}
            className="hidden"
            disabled={isLoading}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
          >
            {isLoading ? "מעבד..." : "בחר קובץ"}
          </Button>

          {/* Batch buttons (cloud engines + authenticated) */}
          {showBatch && (
            <>
              <input
                ref={folderInputRef}
                type="file"
                className="hidden"
                // @ts-ignore
                webkitdirectory=""
                multiple
                onChange={e => addBatchFiles(e.target.files)}
              />
              <input
                ref={batchInputRef}
                type="file"
                className="hidden"
                multiple
                accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.opus,.wma,.amr,.mp4,.webm,.avi,.mov,.mkv,.wmv,.3gp,.aiff,.aif,.caf,.spx,.gsm"
                onChange={e => addBatchFiles(e.target.files)}
              />
              <div className="h-5 w-px bg-border mx-1" />
              <Button variant="outline" size="sm" onClick={() => folderInputRef.current?.click()} disabled={isSubmitting || isLoading}>
                <FolderUp className="w-4 h-4 ml-1" />
                תיקיה
              </Button>
              <Button variant="outline" size="sm" onClick={() => batchInputRef.current?.click()} disabled={isSubmitting || isLoading}>
                <Files className="w-4 h-4 ml-1" />
                מרובה
              </Button>
            </>
          )}

          {/* Background single file button (cloud engines + authenticated) */}
          {isAuthenticated && isCloudEngine && onSubmitBackgroundJob && (
            <>
              <div className="h-5 w-px bg-border mx-1" />
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'audio/*,video/*,.mp3,.wav,.m4a,.flac,.ogg,.opus,.aac,.wma,.amr,.mp4,.webm,.avi,.mov,.mkv,.wmv,.3gp,.aiff,.aif,.caf,.spx,.gsm';
                  input.onchange = async (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;
                    if (file.size > maxFileSizeMB * 1024 * 1024) {
                      toast({ title: `הקובץ גדול מדי`, description: `הגבלה: ${maxFileSizeMB}MB`, variant: "destructive" });
                      return;
                    }
                    await onSubmitBackgroundJob(file);
                  };
                  input.click();
                }}
              >
                🔄 תמלול ברקע
              </Button>
            </>
          )}
        </div>

        {/* Pending batch files */}
        {pendingBatchFiles.length > 0 && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{pendingBatchFiles.length} קבצים ממתינים</span>
              <div className="flex gap-2">
                {!isSubmitting && (
                  <>
                    <Button size="sm" onClick={startBatchProcessing}>
                      <Play className="w-3 h-3 ml-1" />
                      שלח לתמלול
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPendingBatchFiles([])}>
                      נקה
                    </Button>
                  </>
                )}
                {isSubmitting && (
                  <Button size="sm" disabled>
                    <Loader2 className="w-3 h-3 ml-1 animate-spin" />
                    מעלה...
                  </Button>
                )}
              </div>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {pendingBatchFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 p-1.5 rounded bg-muted/50 text-sm">
                  <Upload className="w-3 h-3 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1" title={f.name}>{f.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                  <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => removeBatchFile(i)}>
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Batch progress */}
        {totalBatch > 0 && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{completedCount} / {totalBatch} הושלמו</span>
              <span>{overallProgress}%</span>
            </div>
            <Progress value={overallProgress} />
            <div className="max-h-40 overflow-y-auto space-y-1">
              {batchJobs.map(job => (
                <div key={job.id} className="flex items-center gap-2 p-1.5 rounded bg-muted/50 text-sm">
                  {job.status === "pending" && <Badge variant="secondary" className="shrink-0 text-[10px]">ממתין</Badge>}
                  {(job.status === "uploading" || job.status === "processing") && <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />}
                  {job.status === "completed" && <CheckCircle className="w-3 h-3 text-primary shrink-0" />}
                  {job.status === "failed" && <AlertCircle className="w-3 h-3 text-destructive shrink-0" />}
                  <span className="truncate flex-1" title={job.file_name || ''}>{job.file_name || 'קובץ'}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{job.progress || 0}%</span>
                  {(job.status === "processing" || job.status === "uploading") && (
                    <div className="w-16"><Progress value={job.progress || 0} className="h-1.5" /></div>
                  )}
                  {job.status === "failed" && onRetryJob && (
                    <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => onRetryJob(job.id)} title="נסה שוב">
                      <RotateCcw className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {completedCount + failedCount === totalBatch && totalBatch > 0 && (
              <div className="p-2 rounded bg-muted text-sm flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-primary" />
                <span>הושלם: {completedCount} הצליחו{failedCount > 0 && <>, <span className="text-destructive">{failedCount} נכשלו</span></>}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
