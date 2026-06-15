/**
 * Client for the heavy-processing Web Worker.
 * - Singleton worker, lazy-initialized.
 * - Promise-based API per task.
 * - Fallback: if the worker fails to load (e.g. blocked, dev edge case),
 *   runs the same logic on the main thread so callers never break.
 */

type WorkerTask = 'normalizeText' | 'chunkTextForAI' | 'mergeAdjacentSegments' | 'countWords';

interface Pending {
  resolve: (v: any) => void;
  reject: (e: any) => void;
}

let worker: Worker | null = null;
let workerBroken = false;
const pending = new Map<string, Pending>();

function getWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(
      new URL('../workers/heavyProcessing.worker.ts', import.meta.url),
      { type: 'module' }
    );
    worker.addEventListener('message', (ev: MessageEvent) => {
      const { id, ok, result, error } = ev.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error || 'Worker error'));
    });
    worker.addEventListener('error', (e) => {
      console.warn('[heavyProcessing] worker error', e.message);
      workerBroken = true;
      worker = null;
      // Reject all in-flight
      pending.forEach(({ reject }) => reject(new Error('Worker crashed')));
      pending.clear();
    });
  } catch (e) {
    console.warn('[heavyProcessing] failed to spawn worker, falling back', e);
    workerBroken = true;
    worker = null;
  }
  return worker;
}

function runOnWorker<T>(task: WorkerTask, payload: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    if (!w) return reject(new Error('worker-unavailable'));
    const id = crypto.randomUUID();
    pending.set(id, { resolve, reject });
    w.postMessage({ id, task, payload });
  });
}

// ── Main-thread fallbacks (kept tiny; mirror the worker logic) ─────────────
function fallbackNormalize(text: string): string {
  let t = (text || '').replace(/\r\n?/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\s+([.,;:!?\u05BE\u05C3])/g, '$1');
  return t.trim();
}
function fallbackChunk(text: string, maxChars = 4000): string[] {
  if (!text) return [];
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) out.push(text.slice(i, i + maxChars));
  return out;
}
function fallbackCount(text: string) {
  const t = (text || '').trim();
  return { words: t ? t.split(/\s+/).length : 0, chars: t.length };
}

export async function normalizeText(text: string): Promise<string> {
  try { return await runOnWorker<string>('normalizeText', { text }); }
  catch { return fallbackNormalize(text); }
}

export async function chunkTextForAI(text: string, maxChars = 4000): Promise<string[]> {
  try { return await runOnWorker<string[]>('chunkTextForAI', { text, maxChars }); }
  catch { return fallbackChunk(text, maxChars); }
}

export async function mergeAdjacentSegments<T extends { text: string; start: number; end: number; speaker?: string | null }>(
  segments: T[],
  maxGap = 0.8
): Promise<T[]> {
  try { return await runOnWorker<T[]>('mergeAdjacentSegments', { segments, maxGap }); }
  catch { return segments; }
}

export async function countWords(text: string): Promise<{ words: number; chars: number }> {
  try { return await runOnWorker<{ words: number; chars: number }>('countWords', { text }); }
  catch { return fallbackCount(text); }
}
