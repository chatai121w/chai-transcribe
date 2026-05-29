/**
 * Singleton WAV-encoder worker manager.
 *
 * The worker thread does the Float32 → Int16 PCM conversion + WAV header
 * writing, keeping that CPU work off the main thread. The Float32Array is
 * transferred (zero-copy), so even multi-MB audio segments don't block.
 *
 * Usage:
 *   import { encodeWavInWorker } from '@/lib/wavEncoderWorker';
 *   const wavBuffer = await encodeWavInWorker(monoData, sampleRate);
 */

let _worker: Worker | null = null;
const _pending = new Map<
  string,
  { resolve: (ab: ArrayBuffer) => void; reject: (e: Error) => void }
>();
let _idSeq = 0;

function getWorker(): Worker {
  if (_worker) return _worker;

  _worker = new Worker(
    new URL("../workers/wavEncoder.worker.ts", import.meta.url),
    { type: "module" }
  );

  _worker.onmessage = (
    e: MessageEvent<{ id: string; ok: boolean; wav?: ArrayBuffer; error?: string }>
  ) => {
    const { id, ok, wav, error } = e.data;
    const entry = _pending.get(id);
    if (!entry) return;
    _pending.delete(id);
    if (ok && wav) entry.resolve(wav);
    else entry.reject(new Error(error ?? "wavEncoder worker error"));
  };

  _worker.onerror = (e) => {
    console.error("[wavEncoder-worker]", e.message);
    _pending.forEach(({ reject }) => reject(new Error(e.message)));
    _pending.clear();
    _worker = null;
  };

  return _worker;
}

/**
 * Encodes a mono Float32Array to a WAV ArrayBuffer in a Web Worker.
 * The `monoData` buffer is transferred (zero-copy) — do NOT use it after this call.
 */
export function encodeWavInWorker(
  monoData: Float32Array,
  sampleRate: number
): Promise<ArrayBuffer> {
  const id = `wav-${++_idSeq}`;
  return new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    try {
      // Transfer monoData.buffer — caller must not hold other references to it
      getWorker().postMessage({ id, monoData, sampleRate }, [monoData.buffer]);
    } catch (err) {
      _pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
