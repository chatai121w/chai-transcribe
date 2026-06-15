/**
 * Retry wrapper for transient network errors.
 *
 * Used by transcription paths when the ff_auto_resume flag is on:
 * automatically retries on common network failures (offline, fetch
 * abort, 502/503/504) with capped exponential backoff.
 */

import { readFlag } from "@/lib/featureFlags";

const TRANSIENT_PATTERNS = [
  /Failed to fetch/i,
  /Network ?Error/i,
  /timeout/i,
  /timed out/i,
  /ECONN/i,
  /ENOTFOUND/i,
  /aborted/i,
  /50[234]/, // 502/503/504
];

function isTransient(err: unknown): boolean {
  if (!err) return false;
  if (!navigator.onLine) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some(p => p.test(msg));
}

async function waitOnline(timeoutMs: number): Promise<void> {
  if (navigator.onLine) return;
  await new Promise<void>(resolve => {
    const t = setTimeout(() => {
      window.removeEventListener("online", handler);
      resolve();
    }, timeoutMs);
    const handler = () => {
      clearTimeout(t);
      window.removeEventListener("online", handler);
      resolve();
    };
    window.addEventListener("online", handler);
  });
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, err: unknown) => void;
  /** Force-enable retry even if the flag is off (e.g., for critical calls). */
  force?: boolean;
}

/**
 * Wrap an async call with auto-resume retry logic.
 * Returns the result, or throws the last error if all attempts fail.
 */
export async function withAutoResume<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const enabled = opts.force ?? readFlag("ff_auto_resume");
  if (!enabled) return fn();

  const maxAttempts = opts.maxAttempts ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 1500;
  const maxDelayMs = opts.maxDelayMs ?? 15000;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransient(err)) throw err;
      opts.onRetry?.(attempt, err);
      // Wait for network if offline, plus exponential backoff.
      await waitOnline(30000);
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
