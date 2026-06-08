import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Cloud, X, Check, AlertCircle, Loader2, ChevronDown, ChevronUp,
  FileText, ExternalLink, Trash2,
} from 'lucide-react';
import { driveUploadQueue, type DriveUploadJob } from '@/lib/driveUploadQueue';

const StatusIcon = ({ status }: { status: DriveUploadJob['status'] }) => {
  switch (status) {
    case 'pending':
    case 'checking':
    case 'uploading':
      return <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-600" />;
    case 'awaiting-confirm':
      return <AlertCircle className="w-3.5 h-3.5 text-orange-500" />;
    case 'waiting-network':
      return <Cloud className="w-3.5 h-3.5 text-yellow-600 animate-pulse" />;
    case 'done':
      return <Check className="w-3.5 h-3.5 text-green-600" />;
    case 'skipped':
      return <X className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'error':
      return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
  }
};

const statusLabel: Record<DriveUploadJob['status'], string> = {
  pending: 'בהמתנה',
  checking: 'בודק קיים...',
  'awaiting-confirm': 'דרוש אישור',
  uploading: 'מעלה...',
  'waiting-network': 'ממתין לחיבור',
  done: 'הועלה',
  skipped: 'דולג',
  error: 'שגיאה',
};

export const DriveUploadStatus = () => {
  const [, force] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [applyAll, setApplyAll] = useState(false);

  useEffect(() => {
    void driveUploadQueue.restoreFromDb();
    const unsub = driveUploadQueue.subscribe(() => force((n) => n + 1));
    return () => { unsub(); };
  }, []);

  const jobs = driveUploadQueue.jobs;
  if (jobs.length === 0) return null;

  const total = jobs.length;
  const done = jobs.filter((j) => j.status === 'done' || j.status === 'skipped').length;
  const errors = jobs.filter((j) => j.status === 'error').length;
  const allFinished = jobs.every(
    (j) => j.status === 'done' || j.status === 'skipped' || j.status === 'error'
  );

  const handleResolve = (jobId: string, res: 'overwrite' | 'duplicate' | 'skip') => {
    driveUploadQueue.resolve(jobId, res, applyAll);
  };

  return (
    <Card
      dir="rtl"
      className="fixed bottom-4 left-4 w-[380px] z-50 shadow-2xl border-yellow-500/40 bg-background"
    >
      <div className="flex items-center justify-between p-3 border-b bg-muted/40">
        <div className="flex items-center gap-2">
          <Cloud className="w-4 h-4 text-yellow-600" />
          <span className="text-sm font-semibold">העלאה ל-Google Drive</span>
          <Badge variant="outline" className="text-[10px]">
            {done}/{total}
            {errors > 0 && <span className="text-destructive mr-1">· {errors} שגיאות</span>}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setCollapsed((v) => !v)}>
            {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
          {allFinished && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => driveUploadQueue.reset()}
              title="סגור"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="px-3 pt-2">
            <Progress value={(done / total) * 100} className="h-1.5" />
          </div>

          <div className="max-h-[280px] overflow-y-auto p-2 space-y-1">
            {jobs.map((j) => (
              <div
                key={j.id}
                className="flex flex-col gap-1 rounded border bg-muted/20 p-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <StatusIcon status={j.status} />
                  <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate text-xs flex-1" title={j.name}>{j.name}</span>
                  <span className="text-[10px] text-muted-foreground">{statusLabel[j.status]}</span>
                  {j.webViewLink && (
                    <a
                      href={j.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-yellow-600 hover:text-yellow-700"
                      title="פתח ב-Drive"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground pr-6 truncate">
                  → {j.folderName}
                </div>

                {j.status === 'awaiting-confirm' && (
                  <div className="mt-1 rounded bg-orange-500/10 border border-orange-500/30 p-2 space-y-2">
                    <div className="text-[11px] text-foreground">
                      קיים כבר קובץ בשם זה ב-Drive ({j.existing?.length || 1}). מה לעשות?
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <Button size="sm" variant="destructive" className="h-7 text-[11px]"
                        onClick={() => handleResolve(j.id, 'overwrite')}>
                        דרוס
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-[11px]"
                        onClick={() => handleResolve(j.id, 'duplicate')}>
                        שמור כעותק
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[11px]"
                        onClick={() => handleResolve(j.id, 'skip')}>
                        דלג
                      </Button>
                    </div>
                    <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={applyAll}
                        onCheckedChange={(v) => setApplyAll(!!v)}
                        className="h-3 w-3"
                      />
                      החל על כל הקבצים הבאים
                    </label>
                  </div>
                )}

                {(j.status === 'error' || j.status === 'waiting-network') && (
                  <div className="flex items-center justify-between gap-2 pr-6">
                    {j.error && (
                      <div className="text-[10px] text-destructive truncate flex-1" title={j.error}>
                        {j.error}
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[10px] shrink-0"
                      onClick={() => void driveUploadQueue.retry(j.id)}
                    >
                      נסה שוב
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {allFinished && (
            <div className="p-2 border-t flex justify-end">
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                onClick={() => driveUploadQueue.clearFinished()}>
                <Trash2 className="w-3 h-3 ml-1" /> נקה רשימה
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
};
