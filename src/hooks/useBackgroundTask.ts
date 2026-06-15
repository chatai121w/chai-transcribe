import { useCallback, useRef, useState } from 'react';
import { debugLog } from '@/lib/debugLogger';
import { toast } from '@/hooks/use-toast';

export type BgStatus = 'idle' | 'running' | 'done' | 'error';

interface BgResult<T> {
  data?: T;
  error?: string;
}

/**
 * Runs an async task (transcription) that survives tab-hide and
 * fires a browser Notification when it completes in the background.
 */
export function useBackgroundTask<T = unknown>() {
  const [status, setStatus] = useState<BgStatus>('idle');
  const [result, setResult] = useState<BgResult<T>>({});
  const runningRef = useRef(false);

  // Request Notification permission once
  const ensureNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }, []);

  const notifyIfHidden = useCallback((title: string, body: string) => {
    if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  }, []);

  /**
   * Run the given async function as a background-safe task.
   * The promise is NOT awaited on the caller side —
   * status/result are updated reactively.
   */
  const run = useCallback(
    async (taskName: string, fn: () => Promise<T>): Promise<T | undefined> => {
      if (runningRef.current) {
        debugLog.warn('BackgroundTask', `Task already running, ignored: ${taskName}`);
        toast({ title: 'משימה בתהליך', description: 'המתן לסיום המשימה הנוכחית', variant: 'destructive' });
        return undefined;
      }
      runningRef.current = true;
      setStatus('running');
      setResult({});
      debugLog.info('BackgroundTask', `Started: ${taskName}`);

      // Fire-and-forget — never block the actual task on permission
      ensureNotificationPermission().catch(() => {});

      try {
        const data = await fn();
        setResult({ data });
        setStatus('done');
        debugLog.info('BackgroundTask', `Completed: ${taskName}`);
        notifyIfHidden('תמלול הושלם ✅', taskName);
        return data;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setResult({ error: msg });
        setStatus('error');
        debugLog.error('BackgroundTask', `Failed: ${taskName}`, msg);
        notifyIfHidden('שגיאה בתמלול ❌', msg);
        throw err;
      } finally {
        runningRef.current = false;
      }
    },
    [ensureNotificationPermission, notifyIfHidden],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setResult({});
  }, []);

  return { status, result, run, reset, isRunning: status === 'running' };
}
