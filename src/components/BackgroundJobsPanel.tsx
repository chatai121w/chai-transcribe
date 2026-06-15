import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, CheckCircle2, XCircle, RefreshCw, Trash2, FileText, Clock
} from "lucide-react";
import type { TranscriptionJob } from "@/hooks/useTranscriptionJobs";

interface BackgroundJobsPanelProps {
  jobs: TranscriptionJob[];
  onRetry: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onUseResult: (text: string, engine: string) => void;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  uploading: { label: "מעלה...", color: "bg-blue-500", icon: Loader2 },
  pending: { label: "ממתין", color: "bg-yellow-500", icon: Clock },
  processing: { label: "מעבד...", color: "bg-primary", icon: Loader2 },
  completed: { label: "הושלם", color: "bg-green-500", icon: CheckCircle2 },
  failed: { label: "נכשל", color: "bg-destructive", icon: XCircle },
};

export const BackgroundJobsPanel = ({ jobs, onRetry, onDelete, onUseResult }: BackgroundJobsPanelProps) => {
  const navigate = useNavigate();

  if (jobs.length === 0) return null;

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  };

  return (
    <Card className="p-4" dir="rtl">
      <div className="flex items-center gap-2 mb-3 justify-end">
        <Badge variant="secondary" className="text-xs">
          {jobs.filter(j => j.status !== 'completed' && j.status !== 'failed').length} פעילים
        </Badge>
        <h3 className="font-semibold text-base">תמלולים ברקע</h3>
        <Clock className="w-5 h-5 text-primary" />
      </div>

      <ScrollArea className="max-h-[300px]">
        <div className="space-y-2">
          {jobs.map(job => {
            const config = statusConfig[job.status] || statusConfig.pending;
            const StatusIcon = config.icon;
            const isActive = job.status === 'uploading' || job.status === 'pending' || job.status === 'processing';

            return (
              <div
                key={job.id}
                className="flex flex-row-reverse items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors"
              >
                <StatusIcon className={`w-5 h-5 shrink-0 ${isActive ? 'animate-spin text-primary' : job.status === 'completed' ? 'text-green-500' : 'text-destructive'}`} />

                <div className="flex-1 min-w-0 text-right">
                  <p className="text-sm font-medium truncate">
                    {job.file_name || 'קובץ אודיו'}
                  </p>
                  <div className="flex flex-row-reverse items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-xs py-0">
                      {job.engine}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatTime(job.created_at)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {config.label}
                    </span>
                  </div>

                  {isActive && (
                    <div className="mt-1.5">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] text-muted-foreground font-mono">{job.progress}%</span>
                      </div>
                      <Progress value={job.progress} className="h-1.5" />
                    </div>
                  )}

                  {job.status === 'failed' && job.error_message && (
                    <p className="text-xs text-destructive mt-1">{job.error_message}</p>
                  )}

                  {/* Show partial result for active/failed jobs */}
                  {job.partial_result && job.status !== 'completed' && (
                    <details className="mt-1.5">
                      <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                        📝 הצג מה שכבר תומלל ({job.completed_chunks || 0}/{job.total_chunks || 1} חלקים)
                      </summary>
                      <p className="text-xs text-muted-foreground mt-1 p-2 bg-muted/50 rounded max-h-[100px] overflow-y-auto text-right leading-relaxed" dir="rtl">
                        {job.partial_result.slice(0, 500)}{job.partial_result.length > 500 ? '...' : ''}
                      </p>
                    </details>
                  )}
                </div>

                <div className="flex flex-row-reverse items-center gap-1 shrink-0">
                  {job.status === 'completed' && job.result_text && (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs gap-1"
                      onClick={() => {
                        onUseResult(job.result_text!, job.engine);
                        navigate('/text-editor', { state: { text: job.result_text } });
                      }}
                    >
                      <FileText className="w-3 h-3" />
                      פתח
                    </Button>
                  )}
                  {job.status === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => onRetry(job.id)}
                    >
                      <RefreshCw className="w-3 h-3" />
                      נסה שוב
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(job.id)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
};
