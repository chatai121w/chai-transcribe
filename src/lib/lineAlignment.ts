/**
 * Line-level alignment for the mirrored transcript panes.
 *
 * When one pane is locked, the two sides show different versions of the same
 * text and have to be padded so matching lines sit opposite each other. That is
 * a diff, and a diff over the whole transcript is quadratic: at nine hundred
 * lines a naive matrix is eight hundred thousand cells, built synchronously the
 * moment the mode is switched on.
 *
 * Editing leaves the text above and below the edit untouched, so the shared
 * prefix and suffix are trimmed and only the span that actually differs is
 * diffed — usually a handful of rows.
 */

export type AlignOp =
  | { t: 'eq'; a: number; b: number }
  | { t: 'del'; a: number }
  | { t: 'ins'; b: number };

/**
 * Beyond this many cells the exact diff is abandoned in favour of pairing rows
 * off positionally. That loses precision on a transcript rewritten wholesale,
 * but the alternative is allocating a matrix large enough to freeze the tab.
 */
export const MAX_ALIGN_CELLS = 250_000;

/**
 * Build the edit script aligning `snapshot` (the locked side) to `current`.
 *
 * Indices in the returned ops address the original arrays, so callers can use
 * them directly regardless of the trimming done internally.
 */
export function buildLineAlignment(
  snapshot: readonly string[],
  current: readonly string[],
  maxCells: number = MAX_ALIGN_CELLS,
): AlignOp[] {
  const A = snapshot;
  const B = current;
  const n = A.length;
  const m = B.length;

  let pre = 0;
  while (pre < n && pre < m && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && A[n - 1 - suf] === B[m - 1 - suf]) suf++;

  const midN = n - pre - suf;
  const midM = m - pre - suf;

  const ops: AlignOp[] = [];
  for (let k = 0; k < pre; k++) ops.push({ t: 'eq', a: k, b: k });

  if (midN * midM > maxCells) {
    const paired = Math.min(midN, midM);
    for (let k = 0; k < paired; k++) {
      ops.push({ t: 'del', a: pre + k });
      ops.push({ t: 'ins', b: pre + k });
    }
    for (let k = paired; k < midN; k++) ops.push({ t: 'del', a: pre + k });
    for (let k = paired; k < midM; k++) ops.push({ t: 'ins', b: pre + k });
  } else if (midN || midM) {
    // One flat typed array rather than nested arrays: a single allocation, and
    // a known row stride instead of per-row indirection in the inner loop.
    const w = midM + 1;
    const dp = new Int32Array((midN + 1) * w);
    for (let i = 1; i <= midN; i++) {
      const ai = A[pre + i - 1];
      for (let j = 1; j <= midM; j++) {
        dp[i * w + j] = ai === B[pre + j - 1]
          ? dp[(i - 1) * w + (j - 1)] + 1
          : Math.max(dp[(i - 1) * w + j], dp[i * w + (j - 1)]);
      }
    }
    const mid: AlignOp[] = [];
    let i = midN;
    let j = midM;
    while (i > 0 && j > 0) {
      if (A[pre + i - 1] === B[pre + j - 1]) {
        mid.push({ t: 'eq', a: pre + i - 1, b: pre + j - 1 }); i--; j--;
      } else if (dp[(i - 1) * w + j] >= dp[i * w + (j - 1)]) {
        mid.push({ t: 'del', a: pre + i - 1 }); i--;
      } else {
        mid.push({ t: 'ins', b: pre + j - 1 }); j--;
      }
    }
    while (i > 0) { mid.push({ t: 'del', a: pre + i - 1 }); i--; }
    while (j > 0) { mid.push({ t: 'ins', b: pre + j - 1 }); j--; }
    mid.reverse();
    ops.push(...mid);
  }

  for (let k = 0; k < suf; k++) ops.push({ t: 'eq', a: n - suf + k, b: m - suf + k });
  return ops;
}

/** How many lines the alignment managed to match. Used by the tests. */
export function alignedLineCount(ops: readonly AlignOp[]): number {
  let count = 0;
  for (const op of ops) if (op.t === 'eq') count++;
  return count;
}
