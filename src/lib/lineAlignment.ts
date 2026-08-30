/** Line-level alignment for the mirrored transcript panes. */

export type AlignOp =
  | { t: 'eq'; a: number; b: number }
  | { t: 'del'; a: number }
  | { t: 'ins'; b: number };

/** Maximum matrix size used by an exact LCS segment. */
export const MAX_ALIGN_CELLS = 250_000;

type Anchor = { a: number; b: number };

/**
 * Build an edit script aligning `snapshot` to `current`.
 *
 * Small changed regions use exact LCS. Large regions are partitioned around a
 * longest increasing sequence of unique common rows, then each gap is aligned
 * independently. This preserves matches between distant edits without ever
 * allocating an unbounded quadratic matrix.
 */
export function buildLineAlignment(
  snapshot: readonly string[],
  current: readonly string[],
  maxCells: number = MAX_ALIGN_CELLS,
): AlignOp[] {
  const A = snapshot;
  const B = current;
  const ops: AlignOp[] = [];
  const safeMaxCells = Math.max(0, Math.floor(maxCells));

  const exactRange = (aStart: number, aEnd: number, bStart: number, bEnd: number): AlignOp[] => {
    const n = aEnd - aStart;
    const m = bEnd - bStart;
    const width = m + 1;
    const dp = new Int32Array((n + 1) * width);

    for (let i = 1; i <= n; i++) {
      const value = A[aStart + i - 1];
      for (let j = 1; j <= m; j++) {
        dp[i * width + j] = value === B[bStart + j - 1]
          ? dp[(i - 1) * width + j - 1] + 1
          : Math.max(dp[(i - 1) * width + j], dp[i * width + j - 1]);
      }
    }

    const result: AlignOp[] = [];
    let i = n;
    let j = m;
    while (i > 0 && j > 0) {
      if (A[aStart + i - 1] === B[bStart + j - 1]) {
        result.push({ t: 'eq', a: aStart + i - 1, b: bStart + j - 1 });
        i--;
        j--;
      } else if (dp[(i - 1) * width + j] >= dp[i * width + j - 1]) {
        result.push({ t: 'del', a: aStart + i - 1 });
        i--;
      } else {
        result.push({ t: 'ins', b: bStart + j - 1 });
        j--;
      }
    }
    while (i > 0) result.push({ t: 'del', a: aStart + --i });
    while (j > 0) result.push({ t: 'ins', b: bStart + --j });
    result.reverse();
    return result;
  };

  const findUniqueAnchors = (aStart: number, aEnd: number, bStart: number, bEnd: number): Anchor[] => {
    const countA = new Map<string, number>();
    const countB = new Map<string, number>();
    const indexB = new Map<string, number>();
    for (let i = aStart; i < aEnd; i++) countA.set(A[i], (countA.get(A[i]) ?? 0) + 1);
    for (let j = bStart; j < bEnd; j++) {
      countB.set(B[j], (countB.get(B[j]) ?? 0) + 1);
      indexB.set(B[j], j);
    }

    const candidates: Anchor[] = [];
    for (let i = aStart; i < aEnd; i++) {
      if (countA.get(A[i]) === 1 && countB.get(A[i]) === 1) {
        candidates.push({ a: i, b: indexB.get(A[i])! });
      }
    }
    if (!candidates.length) return [];

    // Longest increasing subsequence of B positions preserves row order.
    const tails: number[] = [];
    const previous = new Int32Array(candidates.length);
    previous.fill(-1);
    for (let i = 0; i < candidates.length; i++) {
      let low = 0;
      let high = tails.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (candidates[tails[middle]].b < candidates[i].b) low = middle + 1;
        else high = middle;
      }
      if (low > 0) previous[i] = tails[low - 1];
      tails[low] = i;
    }

    const anchors: Anchor[] = [];
    for (let i = tails[tails.length - 1]; i >= 0; i = previous[i]) anchors.push(candidates[i]);
    anchors.reverse();
    return anchors;
  };

  const alignRange = (aStart: number, aEnd: number, bStart: number, bEnd: number): void => {
    while (aStart < aEnd && bStart < bEnd && A[aStart] === B[bStart]) {
      ops.push({ t: 'eq', a: aStart, b: bStart });
      aStart++;
      bStart++;
    }

    let suffix = 0;
    while (
      aStart < aEnd - suffix
      && bStart < bEnd - suffix
      && A[aEnd - 1 - suffix] === B[bEnd - 1 - suffix]
    ) suffix++;

    const middleAEnd = aEnd - suffix;
    const middleBEnd = bEnd - suffix;
    const n = middleAEnd - aStart;
    const m = middleBEnd - bStart;

    if (!n) {
      for (let j = bStart; j < middleBEnd; j++) ops.push({ t: 'ins', b: j });
    } else if (!m) {
      for (let i = aStart; i < middleAEnd; i++) ops.push({ t: 'del', a: i });
    } else if (n * m <= safeMaxCells) {
      ops.push(...exactRange(aStart, middleAEnd, bStart, middleBEnd));
    } else {
      const anchors = findUniqueAnchors(aStart, middleAEnd, bStart, middleBEnd);
      if (anchors.length) {
        let nextA = aStart;
        let nextB = bStart;
        for (const anchor of anchors) {
          alignRange(nextA, anchor.a, nextB, anchor.b);
          ops.push({ t: 'eq', a: anchor.a, b: anchor.b });
          nextA = anchor.a + 1;
          nextB = anchor.b + 1;
        }
        alignRange(nextA, middleAEnd, nextB, middleBEnd);
      } else {
        // No stable anchors exist. Preserve responsiveness and mark the segment
        // changed instead of guessing matches or allocating a huge matrix.
        for (let i = aStart; i < middleAEnd; i++) ops.push({ t: 'del', a: i });
        for (let j = bStart; j < middleBEnd; j++) ops.push({ t: 'ins', b: j });
      }
    }

    for (let k = suffix; k > 0; k--) {
      ops.push({ t: 'eq', a: aEnd - k, b: bEnd - k });
    }
  };

  alignRange(0, A.length, 0, B.length);
  return ops;
}

export function alignedLineCount(ops: readonly AlignOp[]): number {
  let count = 0;
  for (const op of ops) if (op.t === 'eq') count++;
  return count;
}
