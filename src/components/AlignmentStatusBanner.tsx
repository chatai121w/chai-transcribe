import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertTriangle, Link2 } from "lucide-react";

interface AlignmentStatusBannerProps {
  status: 'idle' | 'aligning' | 'aligned' | 'partial' | 'error';
  hasTimings: boolean;
  hasAudio: boolean;
  hasText: boolean;
  wordCount: number;
  coverage?: number;
  /** 0–100 while segments stream in; undefined before the first segment. */
  progress?: number;
  onRetry?: () => void;
}

/**
 * Live status strip shown above the synced transcript so the user knows the
 * word-tracking data is being prepared (and is not broken) while alignment
 * runs in the background.
 */
export function AlignmentStatusBanner({
  status, hasTimings, hasAudio, hasText, wordCount, coverage, progress, onRetry,
}: AlignmentStatusBannerProps) {
  const [elapsed, setElapsed] = useState(0);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    if (status !== 'aligning') return;
    setElapsed(0);
    const iv = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, [status]);

  // Flash a short "tracking active" confirmation when timings arrive.
  useEffect(() => {
    if ((status === 'aligned' || status === 'partial') && hasTimings) {
      setShowDone(true);
      const t = setTimeout(() => setShowDone(false), 6000);
      return () => clearTimeout(t);
    }
  }, [status, hasTimings]);

  if (!hasAudio || !hasText) return null;

  if (status === 'aligning') {
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(elapsed % 60).padStart(2, '0');
    const hasProgress = progress !== undefined && progress > 0;
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-primary/30 bg-primary/5 text-sm" dir="rtl">
        <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              🎯 מסנכרן תזמוני מילים לאודיו{hasProgress ? ` — ${progress}%` : '...'}
            </span>
            <span className="text-xs text-muted-foreground font-mono tabular-nums">{mm}:{ss}</span>
          </div>
          <div className="relative h-1.5 mt-1.5 rounded-full bg-muted overflow-hidden">
            {hasProgress ? (
              <div
                className="absolute top-0 right-0 h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                style={{ width: `${Math.max(progress, 2)}%` }}
              />
            ) : (
              <div
                className="absolute top-0 h-full w-1/3 bg-primary/60 rounded-full"
                style={{ animation: 'transcription-scan 1.6s ease-in-out infinite' }}
              />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {hasTimings
              ? `המעקב כבר פעיל על ${wordCount.toLocaleString('he-IL')} המילים הראשונות — ההמשך נטען ברקע`
              : 'המעקב אחר הטקסט יופעל אוטומטית בסיום — אפשר להמשיך לערוך בינתיים'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'error' && !hasTimings) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/5 text-sm" dir="rtl">
        <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
        <span className="flex-1">הסנכרון לאודיו לא הצליח — המעקב אחר הטקסט לא פעיל</span>
        {onRetry && (
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onRetry}>
            <Link2 className="w-3 h-3" />
            נסה שוב
          </Button>
        )}
      </div>
    );
  }

  if (showDone) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-green-500/30 bg-green-500/5 text-sm" dir="rtl">
        <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
        <span>
          מעקב טקסט פעיל — {wordCount.toLocaleString('he-IL')} מילים מסונכרנות
          {coverage != null && ` · ${Math.round(coverage * 100)}% איכות`}
        </span>
      </div>
    );
  }

  return null;
}
