export type YoutubePerformanceProfile = "stable" | "safe-accelerated";

export interface YoutubePerformanceMetrics {
  profile: YoutubePerformanceProfile;
  model?: string;
  model_was_cached?: boolean;
  audio_duration_sec?: number;
  download_sec?: number;
  model_ready_sec?: number;
  transcribe_sec?: number;
  total_sec?: number;
  rtf?: number | null;
  segments?: number;
  words?: number;
  transcript_sha256?: string;
  fragment_workers?: number;
}

export interface YoutubePerformanceComparison {
  comparable: boolean;
  verdict: "improved" | "neutral" | "regression" | "incomparable";
  speedImprovementPct: number | null;
  transcriptIdentical: boolean | null;
  reason: string;
}

const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Compare an experimental run against the stable run without treating speed as
 * quality. A text hash mismatch always blocks promotion, even when the run was
 * faster. A 5% band prevents normal timing noise from being called a result.
 */
export function compareYoutubePerformance(
  candidate: YoutubePerformanceMetrics | null | undefined,
  baseline: YoutubePerformanceMetrics | null | undefined,
): YoutubePerformanceComparison {
  if (!candidate || !baseline) {
    return { comparable: false, verdict: "incomparable", speedImprovementPct: null, transcriptIdentical: null, reason: "חסרה הרצת בסיס תואמת" };
  }
  if (candidate.model && baseline.model && candidate.model !== baseline.model) {
    return { comparable: false, verdict: "incomparable", speedImprovementPct: null, transcriptIdentical: null, reason: "המנועים שונים" };
  }
  if (typeof candidate.model_was_cached === "boolean" && typeof baseline.model_was_cached === "boolean"
    && candidate.model_was_cached !== baseline.model_was_cached) {
    return { comparable: false, verdict: "incomparable", speedImprovementPct: null, transcriptIdentical: null, reason: "מצב טעינת המודל שונה בין ההרצות" };
  }

  const hashesPresent = Boolean(candidate.transcript_sha256 && baseline.transcript_sha256);
  if (!hashesPresent) {
    return { comparable: false, verdict: "incomparable", speedImprovementPct: null, transcriptIdentical: null, reason: "חסר hash של התמלול; אי אפשר לשלול רגרסיית תוכן" };
  }
  const transcriptIdentical = hashesPresent
    ? candidate.transcript_sha256 === baseline.transcript_sha256
    : null;
  if (transcriptIdentical === false) {
    return { comparable: true, verdict: "regression", speedImprovementPct: null, transcriptIdentical, reason: "התמלול השתנה; נדרשת בדיקת WER/CER לפני אישור" };
  }

  const candidateTime = finitePositive(candidate.total_sec) ? candidate.total_sec
    : finitePositive(candidate.transcribe_sec) ? candidate.transcribe_sec : null;
  const baselineTime = finitePositive(baseline.total_sec) ? baseline.total_sec
    : finitePositive(baseline.transcribe_sec) ? baseline.transcribe_sec : null;
  if (!candidateTime || !baselineTime) {
    return { comparable: false, verdict: "incomparable", speedImprovementPct: null, transcriptIdentical, reason: "חסרים זמני עיבוד" };
  }

  const speedImprovementPct = ((baselineTime - candidateTime) / baselineTime) * 100;
  if (speedImprovementPct >= 5) {
    return { comparable: true, verdict: "improved", speedImprovementPct, transcriptIdentical, reason: "מהיר יותר ללא שינוי בתמלול" };
  }
  if (speedImprovementPct <= -5) {
    return { comparable: true, verdict: "regression", speedImprovementPct, transcriptIdentical, reason: "איטי יותר מהבסיס" };
  }
  return { comparable: true, verdict: "neutral", speedImprovementPct, transcriptIdentical, reason: "השינוי נמצא בטווח רעש המדידה" };
}
