/**
 * ASR evaluation metrics — WER, CER, term-recall, length-ratio, word diff.
 *
 * Pure functions, no dependencies. Use with normalizeHebrew() on both sides
 * BEFORE calling these — identical normalization is required for stable WER.
 */

import { normalizeHebrew, tokenizeHebrew } from './hebrewNormalize';

// ─── Levenshtein (token or char level) ─────────────────────────────────────

function editOps<T>(a: T[], b: T[]): { dist: number; sub: number; ins: number; del: number } {
  const n = a.length;
  const m = b.length;
  if (n === 0) return { dist: m, sub: 0, ins: m, del: 0 };
  if (m === 0) return { dist: n, sub: 0, ins: 0, del: n };

  // Two-row DP, but we also need op counts → use full grid (n,m small for ref/hyp lines)
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,        // deletion
        dp[i][j - 1] + 1,        // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }
  // Back-trace to count op types
  let i = n, j = m, sub = 0, ins = 0, del = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) { i--; j--; continue; }
    const cur = dp[i][j];
    if (i > 0 && j > 0 && dp[i - 1][j - 1] + 1 === cur) { sub++; i--; j--; }
    else if (j > 0 && dp[i][j - 1] + 1 === cur) { ins++; j--; }
    else { del++; i--; }
  }
  return { dist: dp[n][m], sub, ins, del };
}

export function computeWER(ref: string, hyp: string): { wer: number; sub: number; ins: number; del: number; refWords: number } {
  const r = tokenizeHebrew(ref);
  const h = tokenizeHebrew(hyp);
  if (r.length === 0) return { wer: h.length > 0 ? 1 : 0, sub: 0, ins: h.length, del: 0, refWords: 0 };
  const { sub, ins, del } = editOps(r, h);
  return { wer: (sub + ins + del) / r.length, sub, ins, del, refWords: r.length };
}

export function computeCER(ref: string, hyp: string): { cer: number; refChars: number } {
  const r = Array.from(normalizeHebrew(ref).replace(/\s+/g, ''));
  const h = Array.from(normalizeHebrew(hyp).replace(/\s+/g, ''));
  if (r.length === 0) return { cer: h.length > 0 ? 1 : 0, refChars: 0 };
  const { dist } = editOps(r, h);
  return { cer: dist / r.length, refChars: r.length };
}

// ─── Term recall (Hebrew target terms) ─────────────────────────────────────

export function computeTermRecall(
  ref: string,
  hyp: string,
  terms: string[],
): { recall: number; total: number; matched: number; missed: string[] } {
  const refWords = tokenizeHebrew(ref);
  const hypWords = tokenizeHebrew(hyp);
  const refCount = new Map<string, number>();
  const hypCount = new Map<string, number>();
  for (const w of refWords) refCount.set(w, (refCount.get(w) ?? 0) + 1);
  for (const w of hypWords) hypCount.set(w, (hypCount.get(w) ?? 0) + 1);

  const normTerms = terms.map((t) => normalizeHebrew(t)).filter(Boolean);

  let total = 0;
  let matched = 0;
  const missed: string[] = [];
  for (const t of normTerms) {
    const rc = refCount.get(t) ?? 0;
    if (rc === 0) continue;
    const hc = hypCount.get(t) ?? 0;
    total += rc;
    matched += Math.min(rc, hc);
    if (hc < rc) missed.push(t);
  }
  const recall = total === 0 ? NaN : matched / total;
  return { recall, total, matched, missed };
}

export function lenRatio(ref: string, hyp: string): number {
  const r = tokenizeHebrew(ref).length;
  const h = tokenizeHebrew(hyp).length;
  return r === 0 ? 0 : h / r;
}

// ─── Word-level diff (for UI + correction extraction) ──────────────────────

export type DiffOp = { type: 'eq' | 'sub' | 'ins' | 'del'; ref?: string; hyp?: string };

/** Returns aligned word diff between ref and hyp. */
export function wordDiff(ref: string, hyp: string): DiffOp[] {
  const a = tokenizeHebrew(ref);
  const b = tokenizeHebrew(hyp);
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const ops: DiffOp[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'eq', ref: a[i - 1], hyp: b[j - 1] });
      i--; j--;
    } else {
      const cur = dp[i][j];
      if (i > 0 && j > 0 && dp[i - 1][j - 1] + 1 === cur) {
        ops.push({ type: 'sub', ref: a[i - 1], hyp: b[j - 1] }); i--; j--;
      } else if (j > 0 && dp[i][j - 1] + 1 === cur) {
        ops.push({ type: 'ins', hyp: b[j - 1] }); j--;
      } else {
        ops.push({ type: 'del', ref: a[i - 1] }); i--;
      }
    }
  }
  return ops.reverse();
}

/** Extract candidate corrections (wrong→right) from a word diff. */
export function extractCorrectionCandidates(ops: DiffOp[]): Array<{ wrong: string; correct: string }> {
  const out: Array<{ wrong: string; correct: string }> = [];
  for (const op of ops) {
    if (op.type === 'sub' && op.hyp && op.ref && op.hyp !== op.ref) {
      // Filter out one-letter or pure-punctuation differences
      if (op.hyp.length < 2 || op.ref.length < 2) continue;
      out.push({ wrong: op.hyp, correct: op.ref });
    }
  }
  return out;
}

// ─── Ambiguous-word guard (don't auto-apply context-dependent pairs) ───────

const AMBIGUOUS_PAIRS = new Set<string>([
  'רבה|רבא', 'רבא|רבה',
  'אמרת|אמרה',
  'אמר|אמרה',
  'הוא|היא', 'היא|הוא',
]);

export function isAmbiguous(wrong: string, correct: string): boolean {
  return AMBIGUOUS_PAIRS.has(`${normalizeHebrew(wrong)}|${normalizeHebrew(correct)}`);
}
