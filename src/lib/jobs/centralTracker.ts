/**
 * Lightweight wrapper around the central jobs table.
 *
 * Lets any existing flow (convert, cut, transcribe...) mirror its progress
 * into `youtube_jobs` so the user sees a unified status — without rewriting
 * the underlying pipeline.
 *
 * Usage:
 *   const t = await trackJob({ kind: "convert", title: "video.mp4", stages: [{key,label,weight}] });
 *   await t.stage("convert", { status: "running", percent: 40 });
 *   await t.stage("convert", { status: "done" });
 *   await t.finish();
 */
import { supabase } from "@/integrations/supabase/client";
import type { JobKind, JobStage } from "./types";
import { computeOverall } from "./types";

export interface TrackerStageDef {
  key: string;
  label: string;
  weight?: number;
}

export interface TrackJobInput {
  kind: JobKind;
  title: string;
  stages: TrackerStageDef[];
  url?: string;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  mode?: string;
}

export interface StageUpdate {
  status?: "pending" | "running" | "done" | "failed" | "skipped";
  percent?: number;
  error?: string | null;
  detail?: string;
  artifactPath?: string | null;
}

export interface JobTracker {
  jobId: string;
  stage: (key: string, opts: StageUpdate) => Promise<void>;
  finish: () => Promise<void>;
  fail: (err: string) => Promise<void>;
}

function buildStages(defs: TrackerStageDef[]): JobStage[] {
  const totalDefined = defs.reduce((s, d) => s + (d.weight ?? 0), 0);
  return defs.map((d): JobStage => ({
    key: d.key,
    label: d.label,
    status: "pending",
    percent: 0,
    weight: d.weight ?? Math.max(1, Math.round(100 / Math.max(1, defs.length))),
    started_at: null,
    finished_at: null,
    error: null,
    meta: null,
  })).map((s, i, arr) => {
    // normalize weights if none provided
    if (totalDefined === 0 && i === arr.length - 1) {
      const sum = arr.slice(0, -1).reduce((a, b) => a + b.weight, 0);
      s.weight = Math.max(1, 100 - sum);
    }
    return s;
  });
}

export async function trackJob(input: TrackJobInput): Promise<JobTracker | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return null;

  const stages = buildStages(input.stages);
  const { data, error } = await supabase
    .from("youtube_jobs")
    .insert({
      user_id: userId,
      job_kind: input.kind,
      url: input.url ?? input.title,
      title: input.title,
      video_title: input.title,
      thumbnail_url: input.thumbnailUrl ?? null,
      duration_sec: input.durationSec ?? null,
      mode: input.mode ?? input.kind,
      status: "pending",
      progress_pct: 0,
      overall_percent: 0,
      stages,
      current_stage: stages[0]?.key ?? null,
    } as never)
    .select("id")
    .single();

  if (error || !data) {
    console.warn("[centralTracker] failed to create job", error);
    return null;
  }
  const jobId = (data as { id: string }).id;

  const update = async (key: string, opts: StageUpdate) => {
    const { data: cur } = await supabase
      .from("youtube_jobs")
      .select("stages")
      .eq("id", jobId)
      .maybeSingle();
    const curStages = ((cur as { stages?: JobStage[] } | null)?.stages ?? stages) as JobStage[];
    const next: JobStage[] = curStages.map((s) => {
      if (s.key !== key) return s;
      const n: JobStage = { ...s };
      if (opts.status) {
        n.status = opts.status;
        if (opts.status === "running" && !s.started_at) n.started_at = new Date().toISOString();
        if (opts.status === "done" || opts.status === "failed" || opts.status === "skipped") {
          n.finished_at = new Date().toISOString();
          if (opts.status === "done") n.percent = 100;
        }
      }
      if (typeof opts.percent === "number") n.percent = Math.max(0, Math.min(100, opts.percent));
      if (opts.error !== undefined) n.error = opts.error;
      if (opts.artifactPath !== undefined) n.artifact_path = opts.artifactPath;
      if (opts.detail) n.meta = { ...(s.meta || {}), detail: opts.detail };
      return n;
    });
    const overall = computeOverall(next);
    const failed = next.some((s) => s.status === "failed");
    const allDone = next.every((s) => s.status === "done" || s.status === "skipped");
    const status = failed ? "error" : allDone ? "done" : overall > 0 ? "running" : "pending";
    const current = next.find((s) => s.status === "running")?.key
      ?? next.find((s) => s.status === "pending")?.key
      ?? null;
    await supabase
      .from("youtube_jobs")
      .update({
        stages: next,
        current_stage: current,
        overall_percent: overall,
        progress_pct: overall,
        status,
        last_error: failed ? next.find((s) => s.status === "failed")?.error ?? null : null,
        completed_at: allDone ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", jobId);
  };

  return {
    jobId,
    stage: update,
    finish: async () => {
      await supabase
        .from("youtube_jobs")
        .update({
          status: "done",
          overall_percent: 100,
          progress_pct: 100,
          completed_at: new Date().toISOString(),
        } as never)
        .eq("id", jobId);
    },
    fail: async (err: string) => {
      await supabase
        .from("youtube_jobs")
        .update({
          status: "error",
          last_error: err,
        } as never)
        .eq("id", jobId);
    },
  };
}
