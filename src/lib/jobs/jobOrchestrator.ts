import { supabase } from "@/integrations/supabase/client";
import {
  computeOverall,
  STAGE_TEMPLATES,
  type JobKind,
  type JobRecord,
  type JobStage,
  type StageStatus,
} from "./types";

export interface CreateJobInput {
  userId: string;
  jobKind: JobKind;
  url: string;
  title?: string | null;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  mode?: string;
  backend?: string | null;
  resumeToken?: Record<string, unknown> | null;
}

export async function createJob(input: CreateJobInput): Promise<JobRecord> {
  const stages = JSON.parse(JSON.stringify(STAGE_TEMPLATES[input.jobKind]));
  const { data, error } = await supabase
    .from("youtube_jobs")
    // youtube_jobs is the central jobs table now; cast through unknown so TS types
    // generated before the migration still accept the new columns.
    .insert({
      user_id: input.userId,
      job_kind: input.jobKind,
      url: input.url,
      title: input.title ?? null,
      video_title: input.title ?? null,
      thumbnail_url: input.thumbnailUrl ?? null,
      duration_sec: input.durationSec ?? null,
      mode: input.mode ?? input.jobKind,
      backend: input.backend ?? null,
      status: "pending",
      progress_pct: 0,
      overall_percent: 0,
      stages,
      current_stage: stages[0]?.key ?? null,
      resume_token: input.resumeToken ?? null,
    } as never)
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "createJob failed");
  return data as unknown as JobRecord;
}

export async function patchJob(jobId: string, patch: Partial<JobRecord>): Promise<void> {
  await supabase
    .from("youtube_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq("id", jobId);
}

export async function fetchJob(jobId: string): Promise<JobRecord | null> {
  const { data, error } = await supabase
    .from("youtube_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as JobRecord;
}

export interface UpdateStageOpts {
  status?: StageStatus;
  percent?: number;
  error?: string | null;
  artifactPath?: string | null;
  meta?: Record<string, unknown> | null;
}

export async function updateStage(jobId: string, stageKey: string, opts: UpdateStageOpts): Promise<JobRecord> {
  const job = await fetchJob(jobId);
  if (!job) throw new Error("job not found");
  const stages: JobStage[] = (job.stages || []).map((s) => {
    if (s.key !== stageKey) return s;
    const next: JobStage = { ...s };
    if (opts.status) {
      next.status = opts.status;
      if (opts.status === "running" && !s.started_at) next.started_at = new Date().toISOString();
      if (opts.status === "done" || opts.status === "failed" || opts.status === "skipped") {
        next.finished_at = new Date().toISOString();
        if (opts.status === "done") next.percent = 100;
      }
    }
    if (typeof opts.percent === "number") next.percent = Math.max(0, Math.min(100, opts.percent));
    if (opts.error !== undefined) next.error = opts.error;
    if (opts.artifactPath !== undefined) next.artifact_path = opts.artifactPath;
    if (opts.meta) next.meta = { ...(s.meta || {}), ...opts.meta };
    return next;
  });

  const overall = computeOverall(stages);
  const isFailed = stages.some((s) => s.status === "failed");
  const allDone = stages.every((s) => s.status === "done" || s.status === "skipped");
  const current = stages.find((s) => s.status === "running")?.key
    ?? stages.find((s) => s.status === "pending")?.key
    ?? null;

  const status: string = isFailed
    ? "error"
    : allDone
    ? "done"
    : overall > 0
    ? "running"
    : "pending";

  await patchJob(jobId, {
    stages,
    current_stage: current,
    overall_percent: overall,
    progress_pct: overall,
    status,
    last_error: isFailed ? stages.find((s) => s.status === "failed")?.error ?? null : null,
    completed_at: allDone ? new Date().toISOString() : null,
  } as Partial<JobRecord>);

  return { ...job, stages, current_stage: current, overall_percent: overall, status };
}

export async function cancelJob(jobId: string): Promise<void> {
  await patchJob(jobId, { status: "cancelled" } as Partial<JobRecord>);
}

export async function deleteJob(jobId: string): Promise<void> {
  await supabase.from("youtube_jobs").delete().eq("id", jobId);
}

/** Resume policy: return the first stage that is NOT done/skipped. */
export function nextResumableStage(job: JobRecord): JobStage | null {
  return job.stages.find((s) => s.status !== "done" && s.status !== "skipped") ?? null;
}
