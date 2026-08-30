import { describe, it, expect } from 'vitest';
import { buildLineAlignment, alignedLineCount, type AlignOp } from './lineAlignment';

/**
 * The full-matrix diff this module replaced, kept as an oracle. It is simple
 * enough to trust by inspection, so any disagreement between it and the trimmed
 * implementation is a bug in the trimmed one.
 */
function referenceAlignment(A: readonly string[], B: readonly string[]): AlignOp[] {
  const n = A.length;
  const m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = A[i - 1] === B[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ops: AlignOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (A[i - 1] === B[j - 1]) { ops.push({ t: 'eq', a: i - 1, b: j - 1 }); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { ops.push({ t: 'del', a: i - 1 }); i--; }
    else { ops.push({ t: 'ins', b: j - 1 }); j--; }
  }
  while (i > 0) { ops.push({ t: 'del', a: i - 1 }); i--; }
  while (j > 0) { ops.push({ t: 'ins', b: j - 1 }); j--; }
  ops.reverse();
  return ops;
}

/** Reassemble the two padded panes exactly as SyncMirrorLayout does. */
function assemble(ops: readonly AlignOp[], A: readonly string[], B: readonly string[]) {
  const snapshot: Array<{ line: string | null; edited: boolean }> = [];
  const current: Array<{ line: string | null; edited: boolean }> = [];
  for (const op of ops) {
    if (op.t === 'eq') {
      snapshot.push({ line: A[op.a], edited: false });
      current.push({ line: B[op.b], edited: false });
    } else if (op.t === 'del') {
      snapshot.push({ line: A[op.a], edited: true });
      current.push({ line: null, edited: true });
    } else {
      snapshot.push({ line: null, edited: true });
      current.push({ line: B[op.b], edited: true });
    }
  }
  return { snapshot, current };
}

/**
 * What the padded view relies on: the panes are the same height, each one still
 * reads back as its own original text, and a row is only left unmarked when the
 * two sides genuinely agree.
 */
function expectValidAlignment(ops: readonly AlignOp[], A: readonly string[], B: readonly string[]) {
  const { snapshot, current } = assemble(ops, A, B);

  expect(snapshot.length).toBe(current.length);
  expect(snapshot.filter((r) => r.line !== null).map((r) => r.line)).toEqual([...A]);
  expect(current.filter((r) => r.line !== null).map((r) => r.line)).toEqual([...B]);

  for (let k = 0; k < snapshot.length; k++) {
    if (!snapshot[k].edited) expect(snapshot[k].line).toBe(current[k].line);
  }
}

/** Deterministic PRNG, so a failure is reproducible. */
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('buildLineAlignment', () => {
  it('pairs every line when both sides are identical', () => {
    const lines = ['a', 'b', 'c', 'd'];
    const ops = buildLineAlignment(lines, lines);
    expect(ops.every((op) => op.t === 'eq')).toBe(true);
    expect(ops).toHaveLength(4);
    expectValidAlignment(ops, lines, lines);
  });

  it('marks an edited line on both sides and leaves its neighbours alone', () => {
    const before = ['a', 'b', 'c'];
    const after = ['a', 'X', 'c'];
    const ops = buildLineAlignment(before, after);
    const { snapshot, current } = assemble(ops, before, after);

    expect(snapshot.filter((r) => r.edited)).toHaveLength(2); // the del and the ins
    expect(current.filter((r) => r.edited)).toHaveLength(2);
    expect(snapshot[0].edited).toBe(false);
    expect(snapshot[snapshot.length - 1].edited).toBe(false);
    expectValidAlignment(ops, before, after);
  });

  it('handles an insertion, a deletion, and an empty side', () => {
    expectValidAlignment(buildLineAlignment(['a', 'c'], ['a', 'b', 'c']), ['a', 'c'], ['a', 'b', 'c']);
    expectValidAlignment(buildLineAlignment(['a', 'b', 'c'], ['a', 'c']), ['a', 'b', 'c'], ['a', 'c']);
    expectValidAlignment(buildLineAlignment([], ['a']), [], ['a']);
    expectValidAlignment(buildLineAlignment(['a'], []), ['a'], []);
    expectValidAlignment(buildLineAlignment([], []), [], []);
  });

  it('never aligns worse than the full-matrix diff it replaced', () => {
    const random = makeRandom(20260807);
    const alphabet = ['a', 'b', 'c', 'd', 'e'];
    const pick = () => alphabet[Math.floor(random() * alphabet.length)];

    for (let trial = 0; trial < 2000; trial++) {
      const A = Array.from({ length: 1 + Math.floor(random() * 25) }, pick);
      const B = [...A];
      const edits = Math.floor(random() * 5);
      for (let e = 0; e < edits; e++) {
        const at = Math.floor(random() * Math.max(1, B.length));
        const kind = random();
        if (kind < 0.34) B.splice(at, 1);
        else if (kind < 0.67) B.splice(at, 0, pick());
        else if (B.length) B[at] = pick();
      }

      const ops = buildLineAlignment(A, B);
      expectValidAlignment(ops, A, B);
      // Trimming must not cost matches; it should find at least as many as the
      // exhaustive diff.
      expect(alignedLineCount(ops)).toBeGreaterThanOrEqual(alignedLineCount(referenceAlignment(A, B)));
    }
  });

  it('keeps a long transcript with a few edits nearly untouched', () => {
    const before = Array.from({ length: 900 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[400] = 'edited line';
    after.splice(500, 0, 'inserted line');
    after.splice(600, 1);

    const ops = buildLineAlignment(before, after);
    expectValidAlignment(ops, before, after);
    expect(alignedLineCount(ops)).toBe(alignedLineCount(referenceAlignment(before, after)));
  });

  it('preserves matches between distant edits even when the middle exceeds the matrix cap', () => {
    const before = Array.from({ length: 900 }, (_, i) => `line ${i}`);
    const after = [...before];
    after[1] = 'edited near start';
    after[898] = 'edited near end';

    const ops = buildLineAlignment(before, after);
    expectValidAlignment(ops, before, after);
    expect(alignedLineCount(ops)).toBe(898);
  });

  it('falls back to pairing instead of allocating a huge matrix', () => {
    const before = Array.from({ length: 900 }, (_, i) => `alpha ${i}`);
    const after = Array.from({ length: 900 }, (_, i) => `beta ${i}`);

    // Nothing is shared, so trimming saves nothing and the guard has to engage.
    const ops = buildLineAlignment(before, after);
    expectValidAlignment(ops, before, after);
    expect(alignedLineCount(ops)).toBe(0);

    // Raising the cap past the matrix size takes the exact path instead, and it
    // must still produce a valid alignment.
    const exact = buildLineAlignment(before, after, 1_000_000);
    expectValidAlignment(exact, before, after);
  });

  it('trims a shared prefix and suffix rather than diffing the whole text', () => {
    // A cap of one cell allows only a 1×1 middle. If trimming did not happen,
    // this would take the pairing fallback and match nothing.
    const before = [...Array.from({ length: 50 }, (_, i) => `p${i}`), 'old', ...Array.from({ length: 50 }, (_, i) => `s${i}`)];
    const after = [...Array.from({ length: 50 }, (_, i) => `p${i}`), 'new', ...Array.from({ length: 50 }, (_, i) => `s${i}`)];

    const ops = buildLineAlignment(before, after, 1);
    expectValidAlignment(ops, before, after);
    expect(alignedLineCount(ops)).toBe(100);
  });
});
