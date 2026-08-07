import { useCallback, useEffect, useRef, useState } from "react";
import { Server, Loader2, Power } from "lucide-react";
import { getServerUrl } from "@/lib/serverConfig";
import { toast } from "@/hooks/use-toast";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";

type ServerState = 'checking' | 'up' | 'down' | 'starting';

const POLL_UP_MS = 30_000;
const POLL_DOWN_MS = 8_000;

/**
 * Always-visible state of the local transcription server, with a one-click
 * start when it is down.
 *
 * A watchdog normally brings the server back on its own, but nothing is
 * guaranteed — and when it is down the failures surface as bare 502s from
 * whatever the user was trying to do, with no hint of the cause. This names
 * the problem and offers the fix in the same place.
 */
export function LocalServerIndicator() {
  const [state, setState] = useState<ServerState>('checking');
  const [gpu, setGpu] = useState<string | null>(null);
  const startingSince = useRef<number>(0);

  const check = useCallback(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`${getServerUrl()}/health`, { signal: ctrl.signal });
      const data = await res.json();
      if (data?.status === 'ok') {
        setGpu(data.gpu ?? null);
        setState('up');
        startingSince.current = 0;
        return true;
      }
      throw new Error('unhealthy');
    } catch {
      // While a start is in flight, keep saying "starting" — the model takes
      // a while to load and flapping to "down" would just be noise.
      setState((prev) => (
        prev === 'starting' && Date.now() - startingSince.current < 180_000 ? 'starting' : 'down'
      ));
      return false;
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      const up = await check();
      if (cancelled) return;
      timer = setTimeout(loop, up ? POLL_UP_MS : POLL_DOWN_MS);
    };
    void loop();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [check]);

  const handleStart = useCallback(async () => {
    if (state === 'starting' || state === 'up') return;
    setState('starting');
    startingSince.current = Date.now();
    try {
      const res = await fetch('/__api/start-server', { method: 'POST' });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'ההפעלה נכשלה');
      toast({
        title: '🚀 מפעיל את שרת התמלול',
        description: data.message === 'already running'
          ? `השרת כבר רץ בפורט ${data.port}`
          : 'טוען את המודל — ייקח כדקה',
      });
    } catch (e) {
      setState('down');
      startingSince.current = 0;
      toast({
        title: 'לא הצלחתי להפעיל את השרת',
        description: e instanceof Error ? e.message : String(e),
        variant: 'destructive',
      });
    }
  }, [state]);

  // Nothing to say while the first check is still in flight, and nothing worth
  // showing when everything is fine and the server is simply up.
  if (state === 'checking') return null;

  const isUp = state === 'up';
  const isStarting = state === 'starting';

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={handleStart}
            disabled={isUp || isStarting}
            aria-label={isUp ? 'שרת התמלול פעיל' : 'הפעל את שרת התמלול'}
            className={`fixed bottom-4 start-4 z-[60] flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs shadow-lg backdrop-blur transition-colors ${
              isUp
                ? 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300 cursor-default'
                : isStarting
                  ? 'border-primary/40 bg-primary/10 text-primary cursor-wait'
                  : 'border-destructive/50 bg-destructive/10 text-destructive hover:bg-destructive/20'
            }`}
          >
            {isStarting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : isUp
                ? <Server className="w-3.5 h-3.5" />
                : <Power className="w-3.5 h-3.5" />}
            <span className="font-medium">
              {isStarting ? 'מפעיל שרת...' : isUp ? 'שרת פעיל' : 'שרת כבוי — הפעל'}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" dir="rtl">
          {isUp
            ? `שרת התמלול המקומי פעיל${gpu ? ` · ${gpu}` : ''}`
            : isStarting
              ? 'השרת עולה וטוען את המודל — עוד כדקה'
              : 'שרת התמלול המקומי לא מגיב. לחץ להפעלה ידנית.'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
