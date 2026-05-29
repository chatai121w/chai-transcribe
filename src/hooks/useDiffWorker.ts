/**
 * useDiffWorker — singleton Web Worker for DiffMatchPatch computation.
 *
 * The same worker instance is shared across all consumers (lazy-created on
 * first use). Requests are multiplexed via a unique `id` so concurrent calls
 * from different components resolve independently.
 *
 * Usage:
 *   const { runDiff } = useDiffWorker();
 *   const diffs = await runDiff('char', leftText, rightText);
 *   const lineDiffs = await runDiff('line', leftText, rightText);
 */

import { useCallback } from "react";

export type DiffOp = [number, string]; // DiffMatchPatch diff tuple

type DiffType = "char" | "line";

// ── Singleton worker + pending map (shared across all hook instances) ─────────

let _worker: Worker | null = null;
const _pending = new Map<
  string,
  { resolve: (d: DiffOp[]) => void; reject: (e: Error) => void }
>();
let _idSeq = 0;

function getWorker(): Worker {
  if (_worker) return _worker;

  _worker = new Worker(new URL("../workers/diff.worker.ts", import.meta.url), {
    type: "module",
  });

  _worker.onmessage = (e: MessageEvent) => {
    const { id, ok, diffs, error } = e.data as {
      id: string;
      ok: boolean;
      diffs?: DiffOp[];
      error?: string;
    };
    const entry = _pending.get(id);
    if (!entry) return;
    _pending.delete(id);
    if (ok && diffs) entry.resolve(diffs);
    else entry.reject(new Error(error ?? "diff worker error"));
  };

  _worker.onerror = (e) => {
    console.error("[diff-worker]", e.message);
    // Reject all pending and reset so next call recreates the worker
    _pending.forEach(({ reject }) => reject(new Error(e.message)));
    _pending.clear();
    _worker = null;
  };

  return _worker;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useDiffWorker() {
  const runDiff = useCallback(
    (type: DiffType, left: string, right: string): Promise<DiffOp[]> => {
      const id = `diff-${++_idSeq}`;
      return new Promise((resolve, reject) => {
        _pending.set(id, { resolve, reject });
        try {
          getWorker().postMessage({ id, type, left, right });
        } catch (err) {
          _pending.delete(id);
          reject(err);
        }
      });
    },
    []
  );

  return { runDiff };
}
