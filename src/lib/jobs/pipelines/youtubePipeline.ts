/**
 * YouTube pipeline — runs the 5 stages via the central Job Orchestrator.
 * Stages: probe → download → extract_audio → upload_audio → transcribe
 *
 * Strategy: prefer local Flask (yt-dlp full) at localhost:3000; on failure,
 * fall back to the youtube-cobalt edge function (which can route to a self-host).
 */
import { supabase } from "@/integrations/supabase/client";
import { getServerUrl } from "@/lib/serverConfig";
import { createJob, patchJob, updateStage, nextResumableStage, fetchJob } from "../jobOrchestrator";
import { uploadArtifact } from "../artifactStorage";
import type { JobRecord } from "../types";

const YT_REGEX = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]+/;
export const isValidYoutubeUrl = (u: string) => YT_REGEX.test(u.trim());

export interface StartYoutubeParams {
  userId: string;
  url: string;
  mode: "transcribe" | "audio" | "video" | "full";
  audioFormat?: "best" | "mp3" | "wav";
  videoQuality?: "360" | "720" | "1080";
}

function localServer(): string | null {
  try {
    return getServerUrl();
  } catch {
    return null;
  }
}

async function probeLocal(url: string) {
  const srv = localServer();
  if (!srv) return null;
  try {
    const res = await fetch(`${srv}/yt/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function probeCobalt(url: string) {
  const { data, error } = await supabase.functions.invoke("youtube-cobalt", {
    body: { url, action: "info" },
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function startYoutubeJob(params: StartYoutubeParams): Promise<JobRecord> {
  if (!isValidYoutubeUrl(params.url)) throw new Error("קישור YouTube לא תקין");

  // Quick probe first to populate title/thumbnail in the job
  let info: { title?: string; thumbnail?: string; duration?: number; backend: string } | null = null;
  const local = await probeLocal(params.url);
  if (local) {
    info = { title: local.title, thumbnail: local.thumbnail, duration: local.duration, backend: "local" };
  } else {
    try {
      const c = await probeCobalt(params.url);
      info = { title: c?.title, thumbnail: c?.thumbnail, duration: undefined, backend: "cobalt" };
    } catch {
      info = { backend: "cobalt" };
    }
  }

  const job = await createJob({
    userId: params.userId,
    jobKind: "youtube",
    url: params.url,
    title: info.title ?? null,
    thumbnailUrl: info.thumbnail ?? null,
    durationSec: info.duration ?? null,
    mode: params.mode,
    backend: info.backend,
    resumeToken: { mode: params.mode, audioFormat: params.audioFormat, videoQuality: params.videoQuality },
  });

  void runYoutubePipeline(job.id).catch(async (e) => {
    await patchJob(job.id, {
      status: "error",
      last_error: e instanceof Error ? e.message : String(e),
    } as Partial<JobRecord>);
  });

  return job;
}

export async function resumeYoutubeJob(jobId: string): Promise<void> {
  const job = await fetchJob(jobId);
  if (!job) throw new Error("job not found");
  const next = nextResumableStage(job);
  if (!next) return; // nothing to do
  // Reset failed → pending so the runner picks it up
  if (next.status === "failed") {
    await updateStage(jobId, next.key, { status: "pending", error: null });
  }
  void runYoutubePipeline(jobId).catch(async (e) => {
    await patchJob(jobId, {
      status: "error",
      last_error: e instanceof Error ? e.message : String(e),
    } as Partial<JobRecord>);
  });
}

async function runYoutubePipeline(jobId: string): Promise<void> {
  let job = await fetchJob(jobId);
  if (!job) return;

  // ── stage: probe ──
  if (job.stages.find((s) => s.key === "probe")?.status !== "done") {
    await updateStage(jobId, "probe", { status: "running", percent: 30 });
    const local = await probeLocal(job.url);
    const probeData = local ?? (await probeCobalt(job.url).catch(() => null));
    if (!probeData) {
      await updateStage(jobId, "probe", { status: "failed", error: "אי אפשר לבדוק את הקישור" });
      return;
    }
    await updateStage(jobId, "probe", { status: "done", percent: 100, meta: { backend: local ? "local" : "cobalt" } });
    job = (await fetchJob(jobId))!;
  }

  const backend = (job.stages.find((s) => s.key === "probe")?.meta?.backend as string) ?? job.backend ?? "cobalt";
  const resume = (job.resume_token ?? {}) as { mode?: string; audioFormat?: string; videoQuality?: string };

  // ── stage: download ──
  if (job.stages.find((s) => s.key === "download")?.status !== "done") {
    await updateStage(jobId, "download", { status: "running", percent: 5 });

    if (backend === "local") {
      const srv = localServer();
      if (!srv) {
        await updateStage(jobId, "download", { status: "failed", error: "שרת מקומי לא זמין" });
        return;
      }
      const startRes = await fetch(`${srv}/yt/job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: job.url,
          mode: resume.mode ?? job.mode,
          audio_format: resume.audioFormat ?? "best",
          video_quality: resume.videoQuality ?? "720",
        }),
      });
      if (!startRes.ok) {
        await updateStage(jobId, "download", { status: "failed", error: `local server ${startRes.status}` });
        return;
      }
      const { job_id: serverJobId } = await startRes.json();

      // poll
      let done = false;
      while (!done) {
        await new Promise((r) => setTimeout(r, 2000));
        const sRes = await fetch(`${srv}/yt/status/${serverJobId}`);
        if (!sRes.ok) {
          await updateStage(jobId, "download", { status: "failed", error: `status ${sRes.status}` });
          return;
        }
        const s = await sRes.json();
        await updateStage(jobId, "download", { percent: Math.min(95, s.progress_pct ?? 0) });
        if (s.status === "done") {
          await updateStage(jobId, "download", {
            status: "done",
            meta: { server_job_id: serverJobId, outputs: s.output_files ?? [] },
          });
          // Mirror output_files back to job for visibility
          await patchJob(jobId, { output_files: (s.output_files ?? []) as never } as Partial<JobRecord>);
          done = true;
        } else if (s.status === "error") {
          await updateStage(jobId, "download", { status: "failed", error: s.error ?? "unknown" });
          return;
        }
      }
    } else {
      // cobalt: get a direct URL only (no real progress)
      const { data, error } = await supabase.functions.invoke("youtube-cobalt", {
        body: {
          url: job.url,
          mode: (resume.mode === "video" ? "video" : "audio") as "audio" | "video",
          audioFormat: resume.audioFormat ?? "best",
          videoQuality: resume.videoQuality ?? "720",
        },
      });
      if (error || !data?.url) {
        await updateStage(jobId, "download", {
          status: "failed",
          error: error?.message ?? "cobalt לא החזיר קישור",
        });
        return;
      }
      const outputs = [{ kind: resume.mode === "video" ? "video" : "audio", url: data.url, filename: data.filename ?? "media" }];
      await patchJob(jobId, { output_files: outputs as never } as Partial<JobRecord>);
      await updateStage(jobId, "download", { status: "done", meta: { cobalt_url: data.url } });
    }
    job = (await fetchJob(jobId))!;
  }

  // ── stage: extract_audio (only for cobalt; local already produced audio file) ──
  if (job.stages.find((s) => s.key === "extract_audio")?.status !== "done") {
    if (backend === "cobalt") {
      // Cobalt returns the audio URL directly when mode=audio. Nothing to extract.
      await updateStage(jobId, "extract_audio", { status: "skipped" });
    } else {
      await updateStage(jobId, "extract_audio", { status: "done", percent: 100 });
    }
    job = (await fetchJob(jobId))!;
  }

  // ── stage: upload_audio (mirror to pipeline-artifacts) ──
  if (job.stages.find((s) => s.key === "upload_audio")?.status !== "done") {
    if (backend === "cobalt") {
      await updateStage(jobId, "upload_audio", { status: "running", percent: 30 });
      try {
        const cobaltUrl = job.stages.find((s) => s.key === "download")?.meta?.cobalt_url as string | undefined;
        if (cobaltUrl) {
          const r = await fetch(cobaltUrl);
          const blob = await r.blob();
          const path = await uploadArtifact(job.user_id, job.id, "upload_audio", "audio.bin", blob);
          await updateStage(jobId, "upload_audio", { status: "done", artifactPath: path });
        } else {
          await updateStage(jobId, "upload_audio", { status: "skipped" });
        }
      } catch (e) {
        await updateStage(jobId, "upload_audio", {
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
        return;
      }
    } else {
      // local backend keeps files on the user's machine — no cloud mirror needed unless requested
      await updateStage(jobId, "upload_audio", { status: "skipped" });
    }
    job = (await fetchJob(jobId))!;
  }

  // ── stage: transcribe ──
  if (job.stages.find((s) => s.key === "transcribe")?.status !== "done") {
    if (resume.mode !== "transcribe" && resume.mode !== "full") {
      await updateStage(jobId, "transcribe", { status: "skipped" });
    } else {
      // Cloud transcription wiring lives in the existing transcription pipeline.
      // Phase 2 will route this stage through the orchestrator; for now we mark
      // it skipped with a helpful note so the job completes cleanly.
      await updateStage(jobId, "transcribe", {
        status: "skipped",
        error: "תמלול אוטומטי דרך מערכת ה-Jobs יתחבר בפאזה הבאה. השתמש בקובץ האודיו ידנית.",
      });
    }
  }
}
