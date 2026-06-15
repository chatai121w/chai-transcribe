/**
 * GPU sharing policy between Whisper transcription and Ollama text-editing.
 *
 * - 'serial' (default, recommended for 8GB GPUs): only one runs at a time.
 *   When transcribing, Ollama edits queue and wait. When editing locally,
 *   transcription requests queue. The server also unloads Ollama models
 *   before each Whisper job to free VRAM.
 * - 'parallel': allow both at once. Only safe with ≥12GB VRAM.
 */

export type GpuShareMode = 'serial' | 'parallel';

const STORAGE_KEY = 'gpu_share_mode';

export function getGpuShareMode(): GpuShareMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'parallel' ? 'parallel' : 'serial';
  } catch {
    return 'serial';
  }
}

export function setGpuShareMode(mode: GpuShareMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent('gpu-share-mode-changed', { detail: mode }));
  } catch {
    /* ignore */
  }
}

export function subscribeGpuShareMode(fn: (mode: GpuShareMode) => void): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<GpuShareMode>).detail);
  window.addEventListener('gpu-share-mode-changed', handler);
  return () => window.removeEventListener('gpu-share-mode-changed', handler);
}

/** Returns true if Whisper transcription is currently running on the server. */
export async function isWhisperBusy(serverUrl = 'http://localhost:3000'): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.transcribe_active;
  } catch {
    return false;
  }
}

/**
 * Wait until Whisper is idle (or timeout). Polls /health every `pollMs`.
 * Returns true if it became idle, false on timeout.
 */
export async function waitUntilWhisperIdle(
  timeoutMs = 5 * 60 * 1000,
  pollMs = 1500,
  serverUrl = 'http://localhost:3000',
  onWaiting?: (waitedMs: number) => void,
): Promise<boolean> {
  const start = Date.now();
  // Fast path: not busy
  if (!(await isWhisperBusy(serverUrl))) return true;
  while (Date.now() - start < timeoutMs) {
    onWaiting?.(Date.now() - start);
    await new Promise(r => setTimeout(r, pollMs));
    if (!(await isWhisperBusy(serverUrl))) return true;
  }
  return false;
}
