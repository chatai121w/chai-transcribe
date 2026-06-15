import { useState } from 'react';
import { useDiarizationQueue, type QueueJob } from '@/contexts/DiarizationQueueContext';
import { Users, X, ChevronUp, ChevronDown, Loader2, Check, AlertCircle, Trash2, RefreshCw, Pause, RotateCcw } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';

const MODE_LABELS: Record<string, string> = {
  browser: 'דפדפן', whisperx: 'WhisperX', assemblyai: 'AssemblyAI',
  deepgram: 'Deepgram', openai: 'OpenAI', local: 'מקומי',
};

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} שנ׳`;
  return `${Math.floor(sec / 60)} דק׳ ${sec % 60} שנ׳`;
}

function JobItem({ job, onCancel, onRetry, onRemove }: { job: QueueJob; onCancel: () => void; onRetry: () => void; onRemove: () => void }) {
  const isActive = job.status === 'processing' || job.status === 'queued';
  const elapsed = job.completedAt ? job.completedAt - job.createdAt : Date.now() - job.createdAt;

  return (
    <div className={`p-2 rounded-lg border text-xs transition-all ${
      job.status === 'completed' ? 'border-green-500/30 bg-green-500/5' :
      job.status === 'error' ? 'border-red-500/30 bg-red-500/5' :
      job.status === 'processing' ? 'border-primary/30 bg-primary/5' :
      'border-border bg-muted/20'
    }`}>
      <div className="flex items-center justify-between gap-1.5 mb-1">
        <span className="font-medium truncate max-w-[140px]" title={job.fileName}>{job.fileName}</span>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="outline" className="text-[9px] py-0 h-4">{MODE_LABELS[job.mode] || job.mode}</Badge>
          {job.status === 'processing' && (
            <button onClick={onCancel} className="text-muted-foreground hover:text-destructive transition-colors" title="בטל">
              <Pause className="w-3 h-3" />
            </button>
          )}
          {job.status === 'error' && (
            <button onClick={onRetry} className="text-muted-foreground hover:text-primary transition-colors" title="נסה שוב">
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
          {!isActive && (
            <button onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors" title="הסר">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {isActive && (
        <>
          <Progress value={job.progress} className="h-1 mb-1" />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{job.progressStage}</span>
            <span>{Math.round(job.progress)}%</span>
          </div>
        </>
      )}

      {job.status === 'completed' && job.result && (
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
          <Check className="w-3 h-3 text-green-500" />
          <span>{job.result.speaker_count} דוברים</span>
          <span>·</span>
          <span>{formatElapsed(elapsed)}</span>
          {job.cloudSaveId && <><span>·</span><span className="text-green-600">☁ נשמר</span></>}
        </div>
      )}

      {job.status === 'error' && (
        <div className="text-[10px] text-destructive flex items-center gap-1 mt-0.5">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span className="truncate">{job.error}</span>
        </div>
      )}
    </div>
  );
}

export function DiarizationFloatingStatus() {
  const { jobs, activeCount, completedCount, cancelJob, retryJob, removeJob, clearCompleted, maxConcurrent, setMaxConcurrent } = useDiarizationQueue();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();

  // Don't show if no jobs or dismissed
  if (jobs.length === 0 || dismissed) return null;

  const hasActive = activeCount > 0;
  const pendingCount = jobs.filter(j => j.status === 'queued').length;
  const errorCount = jobs.filter(j => j.status === 'error').length;

  return (
    <div className="fixed bottom-4 left-4 z-50 w-72 max-w-[calc(100vw-2rem)]" dir="rtl">
      {/* Collapsed badge */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border shadow-lg backdrop-blur-md transition-all ${
          hasActive
            ? 'bg-primary/90 text-primary-foreground border-primary/50 hover:bg-primary'
            : errorCount > 0
            ? 'bg-destructive/90 text-destructive-foreground border-destructive/50 hover:bg-destructive'
            : 'bg-background/95 text-foreground border-border hover:bg-background'
        }`}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          {hasActive ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
          <span>זיהוי דוברים</span>
          {hasActive && <Badge variant="secondary" className="text-[10px] py-0 h-4 bg-white/20">{activeCount} פעיל</Badge>}
          {pendingCount > 0 && <Badge variant="secondary" className="text-[10px] py-0 h-4 bg-white/20">+{pendingCount} בתור</Badge>}
          {!hasActive && completedCount > 0 && <Badge className="text-[10px] py-0 h-4 bg-green-500">{completedCount} ✓</Badge>}
          {errorCount > 0 && <Badge variant="destructive" className="text-[10px] py-0 h-4">{errorCount} ✗</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </div>
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="mt-1 bg-card/98 backdrop-blur-md border rounded-xl shadow-2xl p-3 space-y-2 max-h-[50vh] overflow-y-auto animate-in slide-in-from-bottom-2 duration-200">
          {/* Controls */}
          <div className="flex items-center justify-between pb-2 border-b">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">במקביל:</span>
              {[1, 2, 3, 4].map(n => (
                <button
                  key={n}
                  className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${
                    maxConcurrent === n ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'
                  }`}
                  onClick={() => setMaxConcurrent(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              {completedCount > 0 && (
                <button onClick={clearCompleted} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                  <Trash2 className="w-3 h-3" />נקה
                </button>
              )}
              <button onClick={() => navigate('/diarization')} className="text-[10px] text-primary hover:underline">
                פתח מערכת
              </button>
              <button onClick={() => setDismissed(true)} className="text-muted-foreground hover:text-foreground mr-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Job list */}
          <div className="space-y-1.5">
            {jobs.slice(0, 15).map(job => (
              <JobItem
                key={job.id}
                job={job}
                onCancel={() => cancelJob(job.id)}
                onRetry={() => retryJob(job.id)}
                onRemove={() => removeJob(job.id)}
              />
            ))}
            {jobs.length > 15 && (
              <p className="text-[10px] text-muted-foreground text-center">+{jobs.length - 15} עוד...</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
