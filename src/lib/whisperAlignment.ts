/**
 * whisperAlignment.ts
 *
 * Aligns an edited word list back to original Whisper word-level timings.
 *
 * Algorithm (industry-standard "LCS Anchor Interpolation"):
 *  1. Normalize both word lists (strip niqqud, punctuation, common Hebrew prefixes)
 *  2. Run LCS (Longest Common Subsequence) on normalized words → anchor pairs
 *  3. For each anchor: carry the original Whisper timing directly
 *  4. For inserted/changed words between anchors: linearly interpolate start/end
 *
 * This gives near-perfect sync for typo/spelling fixes, and graceful degradation
 * for larger edits (proportional only within the changed region, not the whole file).
 */

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

// ── Hebrew normalization ─────────────────────────────────────────────────────

const NIQQUD = /[\u0591-\u05C7]/g;           // cantillation + vowel points
const NON_ALPHA = /[^\u05D0-\u05F4a-zA-Z0-9]/g; // keep Hebrew + Latin + digits
// Common Hebrew conjunctive/prepositional prefixes attached to words
const HEB_PREFIX = /^[וּהֲבְכְלְמִשׁ]+/;

function normalizeHebrew(word: string): string {
  return word
    .replace(NIQQUD, '')
    .replace(NON_ALPHA, '')
    .toLowerCase();
}

function stripPrefix(word: string): string {
  // e.g. "והלך" → "הלך", "ביום" → "יום"
  return word.replace(HEB_PREFIX, '') || word;
}

function similarity(a: string, b: string): number {
  // 1.0 = exact, 0.0 = no overlap
  if (a === b) return 1;
  const aNorm = stripPrefix(a);
  const bNorm = stripPrefix(b);
  if (aNorm === bNorm) return 0.95;
  // One is suffix of other (prefix was added/removed)
  if (aNorm.endsWith(bNorm) || bNorm.endsWith(aNorm))
    return Math.min(aNorm.length, bNorm.length) / Math.max(aNorm.length, bNorm.length);
  return 0;
}

// ── LCS with similarity threshold ────────────────────────────────────────────

/**
 * Returns matched pairs [editedIdx, origIdx] in ascending order.
 * Uses standard DP LCS on normalized words, then validates each match
 * with similarity() to allow fuzzy matches.
 */
function computeLCS(
  editedNorm: string[],
  origNorm: string[],
): Array<[number, number]> {
  const m = editedNorm.length;
  const n = origNorm.length;

  // For very large transcripts, limit DP to keep it O(n * band)
  const MAX_N = 800;
  if (m > MAX_N || n > MAX_N) {
    return computeLCSGreedy(editedNorm, origNorm);
  }

  // Standard DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (similarity(editedNorm[i - 1], origNorm[j - 1]) >= 0.8) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack
  const result: Array<[number, number]> = [];
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (similarity(editedNorm[i - 1], origNorm[j - 1]) >= 0.8 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      result.push([i - 1, j - 1]);
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  return result.reverse();
}

/**
 * Greedy forward-scan LCS for very long transcripts (>800 words).
 * O(n * window) instead of O(n²). Accuracy is nearly identical for typical
 * transcript edits where changes are localized.
 */
function computeLCSGreedy(
  editedNorm: string[],
  origNorm: string[],
): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  let lastOrig = -1;
  const WINDOW = 20;

  for (let ei = 0; ei < editedNorm.length; ei++) {
    const searchFrom = Math.max(lastOrig + 1, 0);
    const searchTo = Math.min(searchFrom + WINDOW, origNorm.length);
    let bestOrig = -1;
    let bestScore = 0.79; // must beat threshold

    for (let oi = searchFrom; oi < searchTo; oi++) {
      const s = similarity(editedNorm[ei], origNorm[oi]);
      if (s > bestScore) {
        bestScore = s;
        bestOrig = oi;
        if (s === 1) break;
      }
    }

    if (bestOrig >= 0) {
      result.push([ei, bestOrig]);
      lastOrig = bestOrig;
    }
  }
  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * User-defined anchor: pins an edited word index to a specific timestamp.
 * Created when the user right-clicks a word and selects "סמן כעוגן".
 */
export interface UserAnchor {
  /** Index in the edited word array. */
  editedIdx: number;
  /** Pinned timing (from current best-guess displayTimings at time of marking). */
  start: number;
  end: number;
}

/**
 * Aligns `editedWords` to `originalTimings` from Whisper.
 *
 * Returns a WordTiming[] where:
 *  - User-defined anchors are pinned exactly (highest priority)
 *  - LCS-matched words carry their exact Whisper timestamp
 *  - Inserted/changed words get interpolated timestamps between anchors
 *
 * Falls back gracefully to proportional distribution if no anchors found.
 */
export function alignEditedToWhisper(
  editedWords: string[],
  originalTimings: WordTiming[],
  userAnchors?: UserAnchor[],
): WordTiming[] {
  if (!editedWords.length) return [];
  if (!originalTimings.length) {
    return editedWords.map((word, i) => ({ word, start: i, end: i + 1 }));
  }

  const editedNorm = editedWords.map(normalizeHebrew);
  const origNorm = originalTimings.map(wt => normalizeHebrew(wt.word));

  // Build anchor map: editedIdx → origIdx from LCS
  const lcsAnchors = computeLCS(editedNorm, origNorm);

  // Build boundary sentinels for interpolation
  const totalDuration = originalTimings.at(-1)?.end ?? 0;

  // ── Merge user-defined anchors (highest priority) ─────────────────────────
  // User anchors inject pinned timings directly; they also act as LCS anchors.
  // We represent them as synthetic "origIdx" sentinels by finding the closest
  // original word to the user-pinned timestamp, then overriding with exact time.
  const userAnchorMap = new Map<number, { start: number; end: number }>();
  if (userAnchors && userAnchors.length > 0) {
    for (const ua of userAnchors) {
      if (ua.editedIdx >= 0 && ua.editedIdx < editedWords.length) {
        userAnchorMap.set(ua.editedIdx, { start: ua.start, end: ua.end });
      }
    }
  }

  // Combine LCS anchors + user anchor positions into sorted list
  // User anchors inject as virtual "origIdx" so interpolation segments work
  const lcsSet = new Map<number, number>(lcsAnchors);
  // For user anchors not already in LCS, inject them by finding closest orig timing
  for (const [ei] of userAnchorMap) {
    if (!lcsSet.has(ei)) {
      const ua = userAnchorMap.get(ei)!;
      // Find the original word closest to the pinned start time
      let bestOi = 0;
      let bestDist = Infinity;
      for (let oi = 0; oi < originalTimings.length; oi++) {
        const d = Math.abs(originalTimings[oi].start - ua.start);
        if (d < bestDist) { bestDist = d; bestOi = oi; }
      }
      lcsSet.set(ei, bestOi);
    }
  }

  const anchors: Array<[number, number]> = Array.from(lcsSet.entries()).sort((a, b) => a[0] - b[0]);

  if (anchors.length === 0 && userAnchorMap.size === 0) {
    // No anchors at all — full proportional fallback
    const step = totalDuration / editedWords.length;
    return editedWords.map((word, i) => ({
      word,
      start: parseFloat((i * step).toFixed(3)),
      end: parseFloat(((i + 1) * step).toFixed(3)),
    }));
  }

  // Sorted anchor list with sentinel anchors at edges
  const sortedAnchors: Array<{ ei: number; oi: number }> = [
    { ei: -1, oi: -1 }, // start sentinel
    ...anchors.map(([ei, oi]) => ({ ei, oi })),
    { ei: editedWords.length, oi: originalTimings.length }, // end sentinel
  ];

  const result: WordTiming[] = new Array(editedWords.length);

  for (let seg = 0; seg < sortedAnchors.length - 1; seg++) {
    const prev = sortedAnchors[seg];
    const next = sortedAnchors[seg + 1];

    // Times at the boundary edges
    const prevTime = prev.oi >= 0 ? originalTimings[prev.oi].end : 0;
    const nextTime = next.oi < originalTimings.length ? originalTimings[next.oi].start : totalDuration;

    const gapWords = next.ei - prev.ei - 1; // unmatched words in this gap

    // Fill anchored word — user anchors override LCS
    if (next.ei < editedWords.length) {
      const ua = userAnchorMap.get(next.ei);
      const origTiming = next.oi < originalTimings.length ? originalTimings[next.oi] : null;
      result[next.ei] = {
        word: editedWords[next.ei],
        start: ua ? ua.start : (origTiming ? origTiming.start : prevTime),
        end:   ua ? ua.end   : (origTiming ? origTiming.end   : prevTime + 0.3),
      };
    }

    // Fill interpolated words in the gap
    if (gapWords <= 0) continue;
    const stepSize = (nextTime - prevTime) / (gapWords + 1);

    for (let k = 0; k < gapWords; k++) {
      const ei = prev.ei + 1 + k;
      if (ei < 0 || ei >= editedWords.length) continue;
      const start = prevTime + k * stepSize;
      const end = prevTime + (k + 1) * stepSize;
      result[ei] = {
        word: editedWords[ei],
        start: parseFloat(start.toFixed(3)),
        end: parseFloat(end.toFixed(3)),
      };
    }
  }

  // Safety: fill any gaps (shouldn't happen, but guard against edge cases)
  for (let i = 0; i < editedWords.length; i++) {
    if (!result[i]) {
      const prev = result[i - 1];
      const start = prev ? prev.end : 0;
      result[i] = { word: editedWords[i], start, end: start + 0.3 };
    }
  }

  return result;
}
