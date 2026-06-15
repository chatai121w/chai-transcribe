import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { FolderUp, Files, Play, X, CheckCircle, AlertCircle, Loader2, Upload, RotateCcw } from "lucide-react";
import { TranscriptionJob } from "@/hooks/useTranscriptionJobs";

interface BatchUploaderProps {
  onSubmitBatch: (files: File[]) => Promise<string[]>;
  onSaveTranscript: (text: string, engine: string, title: string) => Promise<void>;
  onRetryJob: (jobId: string) => Promise<void>;
  jobs: TranscriptionJob[];
  isDisabled?: boolean;
  isAuthenticated?: boolean;
}

function isAudioOrVideo(file: File): boolean {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return true;
  const ext = file.name.toLowerCase().split(".").pop() || "";
  return ["mp3","wav","m4a","ogg","flac","aac","wma","opus","mp4","webm","avi","mov","mkv","wmv","amr","3gp","3gpp","aiff","aif","caf","spx","gsm"].includes(ext);
}

export function BatchUploader({ onSubmitBatch, onSaveTranscript, onRetryJob, jobs, isDisabled, isAuthenticated }: BatchUploaderProps) {
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [submittedJobIds, setSubmittedJobIds] = useState<Set<string>>(new Set());
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const audioFiles = Array.from(fileList).filter(isAudioOrVideo);
    if (audioFiles.length === 0) return;
    setPendingFiles((prev) => [...prev, ...audioFiles]);
  }, []);

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearPending = () => {
    if (isSubmitting) return;
    setPendingFiles([]);
  };

  const startProcessing = async () => {
    if (isSubmitting || pendingFiles.length === 0) return;
    setIsSubmitting(true);

    const ids = await onSubmitBatch(pendingFiles);
    setSubmittedJobIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });

    setPendingFiles([]);
    setIsSubmitting(false);
  };

  // Auto-save completed jobs
  const batchJobs = jobs.filter((j) => submittedJobIds.has(j.id));

  // Auto-save completed jobs as transcripts
  useEffect(() => {
    batchJobs.forEach((job) => {
      if (job.status === 'completed' && job.result_text && !savedJobIds.has(job.id)) {
        setSavedJobIds((prev) => {
          const next = new Set(prev);
          next.add(job.id);
          return next;
        });
        const title = job.file_name?.replace(/\.[^/.]+$/, "") || "תמלול";
        onSaveTranscript(job.result_text, job.engine, title);
      }
    });
  }, [batchJobs, savedJobIds, onSaveTranscript]);

  const completedCount = batchJobs.filter((j) => j.status === "completed").length;
  const failedCount = batchJobs.filter((j) => j.status === "failed").length;
  const totalBatch = batchJobs.length;
  const overallProgress = totalBatch > 0
    ? Math.round(batchJobs.reduce((sum, j) => sum + (j.progress || 0), 0) / totalBatch)
    : 0;

  if (!isAuthenticated) {
    return (
      <Card dir="rtl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Files className="w-5 h-5" />
            העלאה מרובה / תיקיה
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">יש להתחבר כדי להשתמש בהעלאה מרובה עם מעקב התקדמות אמיתי</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card dir="rtl">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Files className="w-5 h-5" />
          העלאה מרובה / תיקיה
          <Badge variant="outline" className="text-xs">מעקב אמיתי מהשרת</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File selection buttons */}
        <div className="flex gap-2 flex-wrap">
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            // @ts-ignore
            webkitdirectory=""
            multiple
            onChange={(e) => addFiles(e.target.files)}
          />
          <input
            ref={filesInputRef}
            type="file"
            className="hidden"
            multiple
            accept="audio/*,video/*,.mp3,.wav,.m4a,.ogg,.flac,.aac,.opus,.wma,.amr,.mp4,.webm,.avi,.mov,.mkv,.wmv,.3gp,.aiff,.aif,.caf,.spx,.gsm"
            onChange={(e) => addFiles(e.target.files)}
          />
          <Button variant="outline" onClick={() => folderInputRef.current?.click()} disabled={isSubmitting || isDisabled}>
            <FolderUp className="w-4 h-4 ml-2" />
            העלה תיקיה
          </Button>
          <Button variant="outline" onClick={() => filesInputRef.current?.click()} disabled={isSubmitting || isDisabled}>
            <Files className="w-4 h-4 ml-2" />
            בחר קבצים
          </Button>

          {pendingFiles.length > 0 && !isSubmitting && (
            <>
              <Button onClick={startProcessing}>
                <Play className="w-4 h-4 ml-2" />
                שלח לתמלול ({pendingFiles.length})
              </Button>
              <Button variant="ghost" size="sm" onClick={clearPending}>
                נקה הכל
              </Button>
            </>
          )}

          {isSubmitting && (
            <Button disabled>
              <Loader2 className="w-4 h-4 ml-2 animate-spin" />
              מעלה...
            </Button>
          )}
        </div>

        {/* Pending files list */}
        {pendingFiles.length > 0 && (
          <div className="max-h-40 overflow-y-auto space-y-1">
            {pendingFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm">
                <Upload className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="truncate flex-1" title={f.name}>{f.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {(f.size / 1024 / 1024).toFixed(1)}MB
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeFile(i)}>
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Overall progress for batch */}
        {totalBatch > 0 && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{completedCount} / {totalBatch} הושלמו</span>
              <span>{overallProgress}%</span>
            </div>
            <Progress value={overallProgress} />
          </div>
        )}

        {/* Active batch jobs */}
        {totalBatch > 0 && (
          <div className="max-h-64 overflow-y-auto space-y-2">
            {batchJobs.map((job) => (
              <div key={job.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm">
                {job.status === "pending" && <Badge variant="secondary" className="shrink-0">ממתין</Badge>}
                {job.status === "uploading" && <Loader2 className="w-4 h-4 animate-spin text-accent shrink-0" />}
                {job.status === "processing" && <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />}
                {job.status === "completed" && <CheckCircle className="w-4 h-4 text-primary shrink-0" />}
                {job.status === "failed" && <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}

                <span className="truncate flex-1" title={job.file_name || ''}>{job.file_name || 'קובץ'}</span>

                <span className="text-xs font-medium text-muted-foreground shrink-0">
                  {job.progress || 0}%
                </span>

                {(job.status === "processing" || job.status === "uploading") && (
                  <div className="w-20">
                    <Progress value={job.progress || 0} className="h-2" />
                  </div>
                )}

                {job.status === "failed" && (
                  <>
                    <span className="text-xs text-destructive truncate max-w-[100px]" title={job.error_message || ''}>
                      {job.error_message}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => onRetryJob(job.id)}
                      title="נסה שוב"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Summary */}
        {totalBatch > 0 && completedCount + failedCount === totalBatch && (
          <div className="p-3 rounded-md bg-muted text-sm flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-primary" />
            <span>
              הושלם: {completedCount} הצליחו
              {failedCount > 0 && <>, <span className="text-destructive">{failedCount} נכשלו</span></>}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
