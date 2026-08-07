/**
 * Honest progress estimation for cloud transcription engines.
 *
 * Cloud engines answer with a single response — there is no server-side
 * progress to report. Instead of animating a fake bar to a fixed point and
 * freezing there, we estimate how long the request should take from this
 * machine's own measured history (perf_monitor_records) and drive the bar
 * against that estimate on an asymptotic curve: it keeps creeping toward 99%
 * when a job runs long, and never claims completion before the response lands.
 */

import type { PerfRecord } from '@/hooks/usePerfMonitor';

const PERF_STORAGE_KEY = 'perf_monitor_records';

/** Conservative real-time factors (processing seconds per audio second). */
const DEFAULT_RTF: Record<string, number> = {
  groq: 0.05,
  deepgram: 0.08,
  openai: 0.15,
  assemblyai: 0.20,
  google: 0.25,
  gemini: 0.30,
};
const FALLBACK_RTF = 0.25;

/** Minimum samples before this machine's history outweighs the default. */
const MIN_SAMPLES = 2;
const MIN_EXPECTED_SECONDS = 4;
const MAX_EXPECTED_SECONDS = 1800;

function normalizeEngine(engine: string): string {
  return engine.toLowerCase().replace(/[^a-z]/g, ' ').trim().split(/\s+/)[0] || '';
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median real-time factor measured on this machine for the given engine.
 * Falls back to a per-engine default until enough samples accumulate.
 */
export function getEngineRtf(engine: string): { rtf: number; source: 'history' | 'default' } {
  const key = normalizeEngine(engine);
  const fallback = DEFAULT_RTF[key] ?? FALLBACK_RTF;
  try {
    const raw = localStorage.getItem(PERF_STORAGE_KEY);
    if (!raw) return { rtf: fallback, source: 'default' };
    const records = JSON.parse(raw) as PerfRecord[];
    const samples = records
      .filter(r => r.status === 'success'
        && normalizeEngine(r.engine || '') === key
        && Number.isFinite(r.rtf) && r.rtf > 0 && r.rtf < 10
        && Number.isFinite(r.audioDuration) && r.audioDuration > 0)
      .slice(0, 20)
      .map(r => r.rtf);
    if (samples.length < MIN_SAMPLES) return { rtf: fallback, source: 'default' };
    return { rtf: median(samples), source: 'history' };
  } catch {
    return { rtf: fallback, source: 'default' };
  }
}

/**
 * How long the transcription itself is expected to take, excluding upload.
 * `audioSeconds` of 0 means "unknown" — the caller gets a neutral estimate.
 */
export function getExpectedProcessingSeconds(engine: string, audioSeconds: number): number {
  const { rtf } = getEngineRtf(engine);
  const base = audioSeconds > 0 ? audioSeconds * rtf : 30;
  // Cloud round-trips carry fixed overhead that dominates for short clips.
  const withOverhead = base + 3;
  return Math.min(MAX_EXPECTED_SECONDS, Math.max(MIN_EXPECTED_SECONDS, withOverhead));
}

/**
 * Progress across the processing phase, on a curve that approaches `ceil`
 * without reaching it: ~80% of the span at the expected time, ~96% at twice
 * that. A job that runs long keeps moving instead of appearing stuck.
 */
export function asymptoticProgress(
  elapsedSeconds: number,
  expectedSeconds: number,
  floor = 50,
  ceil = 99,
): number {
  if (expectedSeconds <= 0) return floor;
  const ratio = Math.max(0, elapsedSeconds) / expectedSeconds;
  const fraction = 1 - Math.exp(-1.6 * ratio);
  return Math.min(ceil, Math.round(floor + (ceil - floor) * fraction));
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return mm > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : `${ss}s`;
}

/** Human-readable stage text for the processing phase. */
export function formatProcessingStatus(elapsedSeconds: number, expectedSeconds: number): string {
  const remaining = expectedSeconds - elapsedSeconds;
  if (remaining > 1) return `☁️ מעבד בענן — נותרו ~${formatClock(remaining)}`;
  if (elapsedSeconds < expectedSeconds * 2) return '☁️ מעבד בענן — לוקח יותר מהצפוי...';
  return '☁️ עדיין מעבד — קובץ ארוך או עומס בשרת';
}

/**
 * Read an audio/video file's duration from metadata only, without decoding it.
 * Resolves 0 when the browser cannot determine it in time.
 */
export function probeDurationFromMetadata(file: File, timeoutMs = 4000): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    const url = URL.createObjectURL(file);
    const media = document.createElement('audio');
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      media.removeAttribute('src');
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    };
    const timer = setTimeout(() => finish(0), timeoutMs);
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish(media.duration);
    media.onerror = () => finish(0);
    media.src = url;
  });
}
