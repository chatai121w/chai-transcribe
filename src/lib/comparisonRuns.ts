/**
 * comparisonRuns — unified storage for every "run" across all comparison systems.
 *
 * Replaces the per-page localStorage scratch pads (`benchmark_verdicts_v1`,
 * `benchmark_learned_v1`, etc.) with a single cloud-backed table.
 *
 * Used by:
 *  - /benchmark (audio enhancement presets)
 *  - /compare?tab=transcripts (transcribe-settings sweep)
 *  - /compare?tab=ground-truth (asr training — WER vs reference)
 *  - /compare?tab=diarization (diarization engines)
 *
 * The TrendsTab queries this table to plot improvement/regression over time
 * for each recording (identified by `recording_fingerprint`).
 */

import { supabase } from '@/integrations/supabase/client';

export type ComparisonKind =
  | 'audio_enhance'
  | 'transcribe_settings'
  | 'asr_ground_truth'
  | 'diarization';

export type UserVerdict = 'best' | 'good' | 'bad';

export interface ComparisonRun {
  id: string;
  user_id: string;
  kind: ComparisonKind;
  recording_fingerprint: string;
  recording_label: string | null;
  audio_duration_ms: number | null;
  engine: string | null;
  model: string | null;
  config_snapshot: Record<string, unknown>;
  hotwords_count: number | null;
  corrections_count: number | null;
  reference_text: string | null;
  hypothesis_text: string | null;
  wer: number | null;
  cer: number | null;
  term_recall: number | null;
  len_ratio: number | null;
  elapsed_ms: number | null;
  user_verdict: UserVerdict | null;
  notes: string | null;
  source_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecordRunInput {
  kind: ComparisonKind;
  recording_fingerprint: string;
  recording_label?: string | null;
  audio_duration_ms?: number | null;
  engine?: string | null;
  model?: string | null;
  config_snapshot?: Record<string, unknown>;
  hotwords_count?: number;
  corrections_count?: number;
  reference_text?: string | null;
  hypothesis_text?: string | null;
  wer?: number | null;
  cer?: number | null;
  term_recall?: number | null;
  len_ratio?: number | null;
  elapsed_ms?: number | null;
  user_verdict?: UserVerdict | null;
  notes?: string | null;
  source_run_id?: string | null;
}

/**
 * Record a single comparison run. Best-effort: failures are logged but never
 * throw, so instrumentation never breaks the host page.
 */
export async function recordRun(input: RecordRunInput): Promise<ComparisonRun | null> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) {
      console.warn('[comparisonRuns] skip — no auth user');
      return null;
    }
    const { data, error } = await supabase
      .from('comparison_runs')
      .insert({
        user_id: user.id,
        kind: input.kind,
        recording_fingerprint: input.recording_fingerprint,
        recording_label: input.recording_label ?? null,
        audio_duration_ms: input.audio_duration_ms ?? null,
        engine: input.engine ?? null,
        model: input.model ?? null,
        config_snapshot: (input.config_snapshot ?? {}) as never,
        hotwords_count: input.hotwords_count ?? 0,
        corrections_count: input.corrections_count ?? 0,
        reference_text: input.reference_text ?? null,
        hypothesis_text: input.hypothesis_text ?? null,
        wer: input.wer ?? null,
        cer: input.cer ?? null,
        term_recall: input.term_recall ?? null,
        len_ratio: input.len_ratio ?? null,
        elapsed_ms: input.elapsed_ms ?? null,
        user_verdict: input.user_verdict ?? null,
        notes: input.notes ?? null,
        source_run_id: input.source_run_id ?? null,
      })
      .select()
      .single();

    if (error) {
      console.warn('[comparisonRuns] insert error', error.message);
      return null;
    }
    return data as ComparisonRun;
  } catch (err) {
    console.warn('[comparisonRuns] recordRun threw', err);
    return null;
  }
}

/** All runs for the current user, newest first. */
export async function listRuns(limit = 500): Promise<ComparisonRun[]> {
  const { data, error } = await supabase
    .from('comparison_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.warn('[comparisonRuns] listRuns error', error.message);
    return [];
  }
  return (data ?? []) as ComparisonRun[];
}

/** All runs for one recording, oldest first (good for trend lines). */
export async function getRunsByRecording(
  recording_fingerprint: string,
): Promise<ComparisonRun[]> {
  const { data, error } = await supabase
    .from('comparison_runs')
    .select('*')
    .eq('recording_fingerprint', recording_fingerprint)
    .order('created_at', { ascending: true });
  if (error) {
    console.warn('[comparisonRuns] getRunsByRecording error', error.message);
    return [];
  }
  return (data ?? []) as ComparisonRun[];
}

/** Update verdict / notes for a single run. */
export async function updateRun(
  id: string,
  patch: Partial<Pick<ComparisonRun, 'user_verdict' | 'notes' | 'recording_label'>>,
): Promise<boolean> {
  const { error } = await supabase
    .from('comparison_runs')
    .update(patch as never)
    .eq('id', id);
  if (error) {
    console.warn('[comparisonRuns] updateRun error', error.message);
    return false;
  }
  return true;
}

/** Delete a single run. */
export async function deleteRun(id: string): Promise<boolean> {
  const { error } = await supabase.from('comparison_runs').delete().eq('id', id);
  if (error) {
    console.warn('[comparisonRuns] deleteRun error', error.message);
    return false;
  }
  return true;
}

// ─── Aggregation helpers ────────────────────────────────────────────────────

export interface RecordingGroup {
  recording_fingerprint: string;
  recording_label: string;
  audio_duration_ms: number | null;
  runs: ComparisonRun[];
  first_at: string;
  last_at: string;
  bestWer: number | null;
  latestWer: number | null;
  delta: number | null; // latest - first (negative = improvement)
  trend: 'improving' | 'regressing' | 'flat' | 'unknown';
}

/** Group a flat list of runs by recording_fingerprint. */
export function groupByRecording(runs: ComparisonRun[]): RecordingGroup[] {
  const map = new Map<string, ComparisonRun[]>();
  for (const r of runs) {
    const arr = map.get(r.recording_fingerprint) ?? [];
    arr.push(r);
    map.set(r.recording_fingerprint, arr);
  }
  const groups: RecordingGroup[] = [];
  for (const [fp, arr] of map.entries()) {
    arr.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const withWer = arr.filter(r => r.wer != null);
    const firstWer = withWer[0]?.wer ?? null;
    const latestWer = withWer.length ? withWer[withWer.length - 1].wer ?? null : null;
    const bestWer = withWer.length ? Math.min(...withWer.map(r => r.wer!)) : null;
    const delta = firstWer != null && latestWer != null ? latestWer - firstWer : null;
    let trend: RecordingGroup['trend'] = 'unknown';
    if (delta != null) {
      if (delta < -0.005) trend = 'improving';
      else if (delta > 0.005) trend = 'regressing';
      else trend = 'flat';
    }
    groups.push({
      recording_fingerprint: fp,
      recording_label: arr[arr.length - 1].recording_label ?? fp,
      audio_duration_ms: arr[arr.length - 1].audio_duration_ms,
      runs: arr,
      first_at: arr[0].created_at,
      last_at: arr[arr.length - 1].created_at,
      bestWer,
      latestWer,
      delta,
      trend,
    });
  }
  // Newest-active first
  groups.sort((a, b) => b.last_at.localeCompare(a.last_at));
  return groups;
}

/** Diff two runs' config snapshots into a flat list of changed keys. */
export function diffConfigs(
  a: Record<string, unknown> | null | undefined,
  b: Record<string, unknown> | null | undefined,
): Array<{ key: string; from: unknown; to: unknown }> {
  const keys = new Set<string>([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  const changes: Array<{ key: string; from: unknown; to: unknown }> = [];
  for (const k of keys) {
    const va = a?.[k];
    const vb = b?.[k];
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      changes.push({ key: k, from: va, to: vb });
    }
  }
  return changes;
}
