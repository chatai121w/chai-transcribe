/**
 * Tracing for the synced-transcript view.
 *
 * Opening the full sync view on a long transcript can bring the machine to a
 * halt, and the symptom — a frozen tab — hides which of several candidates is
 * responsible. These probes report what actually ran: how much work the view
 * was handed, how long each phase took, and how often the highlight moved.
 *
 * Off unless switched on, because the render probe fires on a path that runs
 * many times a second:
 *
 *   localStorage.setItem('debug_sync_perf', '1'); location.reload();
 *
 * To stop:
 *   localStorage.removeItem('debug_sync_perf'); location.reload();
 *
 * A long-task observer runs while tracing, so anything that blocks the main
 * thread past 50ms is reported with the phase that was in flight.
 */

let enabled: boolean | null = null;

export function syncTraceEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem('debug_sync_perf') === '1';
    } catch {
      enabled = false;
    }
  }
  return enabled;
}

const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
const since = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

export function syncLog(event: string, detail?: Record<string, unknown>): void {
  if (!syncTraceEnabled()) return;
  if (detail) console.log(`[SyncPerf ${since()}] ${event}`, detail);
  else console.log(`[SyncPerf ${since()}] ${event}`);
}

/** Time one synchronous phase and report it if it is slow enough to matter. */
export function syncTime<T>(phase: string, fn: () => T, reportOverMs = 8): T {
  if (!syncTraceEnabled()) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    const ms = performance.now() - start;
    if (ms >= reportOverMs) syncLog(`⏱ ${phase}`, { ms: Math.round(ms) });
  }
}

/**
 * Rolling render counter. Rather than logging every render — which would itself
 * distort what it measures — it reports a summary per window: how many renders
 * happened, and how expensive the worst one was.
 */
export function createRenderReporter(label: string, windowMs = 2000) {
  let count = 0;
  let worst = 0;
  let total = 0;
  let windowStart = 0;

  return {
    /** Call at the top of the component body; returns a function to call after commit. */
    begin(): () => void {
      if (!syncTraceEnabled()) return () => { /* noop */ };
      const start = performance.now();
      if (!windowStart) windowStart = start;
      return () => {
        const ms = performance.now() - start;
        count += 1;
        total += ms;
        if (ms > worst) worst = ms;
        const elapsed = performance.now() - windowStart;
        if (elapsed >= windowMs) {
          syncLog(`📊 ${label}`, {
            renders: count,
            perSec: +(count / (elapsed / 1000)).toFixed(1),
            avgMs: Math.round(total / count),
            worstMs: Math.round(worst),
            windowMs: Math.round(elapsed),
          });
          count = 0; worst = 0; total = 0; windowStart = performance.now();
        }
      };
    },
  };
}

/** Report anything that blocks the main thread, with whatever phase was noted last. */
let observer: PerformanceObserver | null = null;
let lastPhase = 'idle';

export function notePhase(phase: string): void {
  if (syncTraceEnabled()) lastPhase = phase;
}

export function startLongTaskWatch(): () => void {
  if (!syncTraceEnabled() || observer) return () => { /* noop */ };
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        syncLog('🧱 main thread blocked', {
          ms: Math.round(entry.duration),
          duringPhase: lastPhase,
        });
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    observer = null;
  }
  return () => {
    observer?.disconnect();
    observer = null;
  };
}
