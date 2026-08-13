import { useEffect, useState } from 'react';
import { Clock3, Loader2 } from 'lucide-react';
import {
  formatMeasuredDuration,
  getMeasuredProgressMetrics,
  type AIEditProgressSnapshot,
} from '@/lib/aiEditProgress';

interface AIEditProgressPanelProps {
  progress: AIEditProgressSnapshot;
  engineLabel: string;
}

export function AIEditProgressPanel({ progress, engineLabel }: AIEditProgressPanelProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [progress.startedAt]);

  const metrics = getMeasuredProgressMetrics(progress, now);
  const hasMeasuredEta = metrics.estimatedRemainingSeconds !== null;
  const isOpaqueSingleRequest = progress.totalUnits === 1 && progress.completedUnits === 0;

  return (
    <div
      className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-right"
      dir="rtl"
      data-testid="ai-edit-progress"
    >
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="inline-flex min-w-0 items-center gap-2 font-medium">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <span className="truncate">{progress.stage} עם {engineLabel}</span>
        </span>
        <strong className="shrink-0 tabular-nums text-primary" data-testid="ai-edit-percent">
          {metrics.percent}%
        </strong>
      </div>

      <div className="relative h-2.5 overflow-hidden rounded-full bg-muted" aria-label="התקדמות עריכת AI">
        <div
          className="absolute inset-y-0 right-0 rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${metrics.percent}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {isOpaqueSingleRequest
            ? 'ממתין לתשובת המנוע; המנוע אינו מדווח אחוז ביניים אמין'
            : `הושלמו ${progress.completedUnits.toLocaleString('he-IL')} מתוך ${progress.totalUnits.toLocaleString('he-IL')} מקטעים`}
        </span>
        <span className="inline-flex items-center gap-3 tabular-nums">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            עבר {formatMeasuredDuration(metrics.elapsedSeconds)}
          </span>
          <span>
            {hasMeasuredEta
              ? `צפי לפי הקצב בפועל ${formatMeasuredDuration(metrics.estimatedRemainingSeconds ?? 0)}`
              : isOpaqueSingleRequest
                ? 'אין צפי אמין עד לקבלת תשובה'
                : 'צפי יחושב אחרי השלמת המקטע הראשון'}
          </span>
        </span>
      </div>
    </div>
  );
}
