/**
 * YouTube pipeline — runs the 5 stages via the central Job Orchestrator.
 * Stages: probe → download → extract_audio → upload_audio → transcribe
 *
 * Strategy: prefer local Flask (yt-dlp full) at localhost:3000; on failure,
 * fall back to the youtube-cobalt edge function (which can route to a self-host).
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchLocalServer, getServerUrl } from "@/lib/serverConfig";
import { resolveLocalServerUrl } from "@/lib/localServerLauncher";
import { createJob, patchJob, updateStage, nextResumableStage, fetchJob } from "../jobOrchestrator";
import { uploadArtifact, downloadArtifact } from "../artifactStorage";
import type { JobRecord } from "../types";
import { db } from "@/lib/localDb";
import type { YoutubePerformanceProfile } from "@/lib/youtubePerformance";

const YT_REGEX = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]+/;
export const isValidYoutubeUrl = (u: string) => YT_REGEX.test(u.trim());

export interface StartYoutubeParams {
  userId: string;
  url: string;
  mode: "transcribe" | "audio" | "video" | "full";
  audioFormat?: "best" | "mp3" | "wav";
  videoQuality?: "360" | "720" | "1080";
  /** If true, upload transcript files (txt/srt/json) to Supabase Storage after local server finishes */
  saveToCloud?: boolean;
  performanceProfile?: YoutubePerformanceProfile;
  engine?: string;
  language?: string;
  model?: string;
  /**
   * Result of the probe the caller already ran. Supplying it skips the probe
   * here, so the job row — and with it the progress readout — exists the moment
   * the user presses start instead of seconds later.
   */
  knownInfo?: { title?: string | null; thumbnail?: string | null; duration?: number | null; backend: string };
}

function localServer(): string | null {
  try {
    return getServerUrl();
  } catch {
    return null;
  }
}

async function probeLocal(url: string) {
  const srv = await resolveLocalServerUrl().catch(() => localServer());
  if (!srv) return null;
  try {
    const res = await fetchLocalServer(`${srv}/yt/info`, {
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

async function getPreferredYoutubeEngine(userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("user_preferences")
      .select("engine")
      .eq("user_id", userId)
      .maybeSingle();
    const engine = (data as { engine?: string } | null)?.engine;
    if (engine && engine !== "local" && engine !== "local-server") return engine;
  } catch {
    // fall through
  }

  try {
    const local = await db.preferences.where("id").equals("current").first();
    const engine = (local as { engine?: string } | undefined)?.engine;
    if (engine && engine !== "local" && engine !== "local-server") return engine;
  } catch {
    // fall through
  }

  try {
    const engine = localStorage.getItem("transcript_engine") || localStorage.getItem("user_preferences");
    if (engine && ["groq", "openai", "google", "assemblyai", "deepgram"].includes(engine)) return engine;
    if (engine) {
      const parsed = JSON.parse(engine);
      if (parsed?.engine && parsed.engine !== "local" && parsed.engine !== "local-server") return parsed.engine;
    }
  } catch {
    // noop
  }

  return "groq";
}

export async function startYoutubeJob(params: StartYoutubeParams): Promise<JobRecord> {
  if (!isValidYoutubeUrl(params.url)) throw new Error("קישור YouTube לא תקין");

  // Title/thumbnail for the job row. The page normally probed already, and
  // re-probing here would stall job creation for seconds with nothing on screen.
  let info: { title?: string | null; thumbnail?: string | null; duration?: number | null; backend: string };
  if (params.knownInfo) {
    info = params.knownInfo;
  } else {
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
    resumeToken: {
      mode: params.mode,
      audioFormat: params.audioFormat,
      videoQuality: params.videoQuality,
      saveToCloud: params.saveToCloud ?? false,
      performanceProfile: params.performanceProfile ?? "stable",
      engine: params.engine,
      language: params.language ?? "auto",
      model: params.model,
    },
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
  const resume = (job.resume_token ?? {}) as {
    mode?: string;
    audioFormat?: string;
    videoQuality?: string;
    saveToCloud?: boolean;
    performanceProfile?: YoutubePerformanceProfile;
    engine?: string;
    language?: string;
    model?: string;
  };

  // ── stage: download ──
  if (job.stages.find((s) => s.key === "download")?.status !== "done") {
    await updateStage(jobId, "download", { status: "running", percent: 5 });

    if (backend === "local") {
      const srv = await resolveLocalServerUrl().catch(() => localServer());
      if (!srv) {
        await updateStage(jobId, "download", { status: "failed", error: "שרת מקומי לא זמין" });
        return;
      }
      const startRes = await fetchLocalServer(`${srv}/yt/job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: job.url,
          mode: resume.mode ?? job.mode,
          audio_format: resume.audioFormat ?? "best",
          video_quality: resume.videoQuality ?? "720",
          performance_profile: resume.performanceProfile ?? "stable",
          language: resume.language ?? "auto",
          model: resume.model,
        }),
      });
      if (!startRes.ok) {
        await updateStage(jobId, "download", { status: "failed", error: `local server ${startRes.status}` });
        return;
      }
      const { job_id: serverJobId } = await startRes.json();

      // Store server_job_id immediately so the frontend can poll for live stats
      await updateStage(jobId, "download", {
        status: "running", percent: 5,
        meta: { server_job_id: serverJobId },
      });

      // poll
      let done = false;
      // The server is polled every 2s, but most polls report the same percentage
      // and status as the one before. Writing each of those to the database costs
      // a read-modify-write, a WAL record carrying the whole row twice (the table
      // is REPLICA IDENTITY FULL for realtime under RLS), and a broadcast that
      // makes every subscribed hook refetch its list — all to redraw an identical
      // number. So a poll is only persisted when it actually says something new.
      let lastPct = -1;
      let lastServerStatus: string | null = null;
      let lastPhase: string | null = null;
      let lastWriteAt = 0;
      // Still write occasionally while nothing changes, so updated_at keeps
      // moving and a stalled job stays distinguishable from a quiet one.
      const HEARTBEAT_MS = 20_000;
      while (!done) {
        await new Promise((r) => setTimeout(r, 2000));
        const sRes = await fetchLocalServer(`${srv}/yt/status/${serverJobId}`);
        if (!sRes.ok) {
          await updateStage(jobId, "download", { status: "failed", error: `status ${sRes.status}` });
          return;
        }
        const s = await sRes.json();
        // Write real-time download metrics into stage meta
        const dlMb  = (s.audio_dl_mb  ?? s.video_dl_mb  ?? 0) as number;
        const totalMb = (s.audio_total_mb ?? s.video_total_mb ?? 0) as number;
        const speedMb = (s.audio_speed_mb ?? s.video_speed_mb ?? 0) as number;

        const pct = Math.min(95, s.progress_pct ?? 0);
        const isTerminal = s.status === "done" || s.status === "error";
        const changed = pct !== lastPct || s.status !== lastServerStatus || s.phase !== lastPhase;
        if (changed || isTerminal || Date.now() - lastWriteAt >= HEARTBEAT_MS) {
          lastPct = pct;
          lastServerStatus = s.status;
          lastPhase = s.phase ?? null;
          lastWriteAt = Date.now();
          await updateStage(jobId, "download", {
            percent: pct,
            meta: {
              server_job_id: serverJobId,
              dl_mb: dlMb, total_mb: totalMb, speed_mb: speedMb,
              server_status: s.status,
              server_pct: s.progress_pct ?? 0,
              phase: s.phase,
              phase_started_at: s.phase_started_at,
              performance_profile: s.performance_profile,
              fragment_workers: s.fragment_workers,
              model_prewarm_status: s.model_prewarm_status,
              model_prewarm_sec: s.model_prewarm_sec,
              download_sec: s.download_sec,
              model_ready_sec: s.model_ready_sec,
              first_segment_sec: s.first_segment_sec,
              metrics: s.metrics,
              // Live transcription position, so the UI can show a real number
              // while the server works through the audio.
              transcribe_sec: s.transcribe_sec ?? 0,
              transcribe_total_sec: s.transcribe_total_sec ?? 0,
              transcribe_segments: s.transcribe_segments ?? 0,
            },
          });
        }
        if (s.status === "done") {
          // Prefix output_files URLs with srv so browser can reach them via proxy
          const serverOutputFiles = (s.output_files ?? []).map((f: Record<string, unknown>) => ({
            ...f,
            url: typeof f.url === "string" && f.url.startsWith("/") ? `${srv}${f.url}` : (f.url ?? ""),
          }));
          const hasTranscript = serverOutputFiles.some(
            (f: Record<string, unknown>) => f.kind === "txt" || f.kind === "srt" || f.kind === "json"
          );
          await updateStage(jobId, "download", {
            status: "done",
            percent: 100,
            meta: {
              server_job_id: serverJobId,
              outputs: serverOutputFiles,
              dl_mb: dlMb,
              total_mb: totalMb,
              server_status: s.status,
              server_pct: 100,
              phase: s.phase,
              phase_started_at: s.phase_started_at,
              performance_profile: s.performance_profile,
              fragment_workers: s.fragment_workers,
              model_prewarm_status: s.model_prewarm_status,
              model_prewarm_sec: s.model_prewarm_sec,
              download_sec: s.download_sec,
              model_ready_sec: s.model_ready_sec,
              first_segment_sec: s.first_segment_sec,
              transcribe_sec: s.transcribe_sec ?? 0,
              transcribe_total_sec: s.transcribe_total_sec ?? 0,
              transcribe_segments: s.transcribe_segments ?? 0,
              metrics: s.metrics,
            },
          });
          // Mirror output_files back to job for visibility
          await patchJob(jobId, { output_files: serverOutputFiles as never } as Partial<JobRecord>);
          // Mark transcribe stage done/skipped based on whether the server actually transcribed
          if (hasTranscript) {
            await updateStage(jobId, "transcribe", {
              status: "done",
              percent: 100,
              meta: { metrics: s.metrics, performance_profile: s.performance_profile },
            });
          }
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
    } else if (resume.saveToCloud) {
      // Local backend + saveToCloud: preserve both source audio and transcript
      // artifacts so another device can reopen the complete editor session.
      await updateStage(jobId, "upload_audio", { status: "running", percent: 10 });
      try {
        const serverOutputFiles = (job.output_files ?? []) as Array<{ kind: string; url: string; filename: string }>;
        const cloudFiles = serverOutputFiles.filter((f) =>
          ["audio", "txt", "srt", "json"].includes(f.kind)
        );
        if (cloudFiles.length === 0) {
          await updateStage(jobId, "upload_audio", { status: "skipped" });
        } else {
          const uploadedPaths: Record<string, string> = {};
          const srv = localServer();
          for (let i = 0; i < cloudFiles.length; i++) {
            const f = cloudFiles[i];
            await updateStage(jobId, "upload_audio", {
              percent: Math.round(10 + (i / cloudFiles.length) * 85),
            });
            const fileUrl = /^https?:\/\//i.test(f.url)
              ? f.url
              : `${srv}${f.url.startsWith("/") ? f.url : `/${f.url}`}`;
            const res = await fetchLocalServer(fileUrl);
            if (!res.ok) continue;
            const blob = await res.blob();
            const stage = f.kind === "audio" ? "audio" : "transcripts";
            const path = await uploadArtifact(job.user_id, job.id, stage, f.filename, blob);
            uploadedPaths[f.kind] = path;
          }
          await updateStage(jobId, "upload_audio", {
            status: "done",
            percent: 100,
            meta: { uploaded_paths: uploadedPaths },
          });
          const cloudBackedOutputs = serverOutputFiles.map((file) => ({
            ...file,
            ...(uploadedPaths[file.kind] ? { artifactPath: uploadedPaths[file.kind] } : {}),
          }));
          await patchJob(jobId, { output_files: cloudBackedOutputs as never } as Partial<JobRecord>);
        }
      } catch (e) {
        await updateStage(jobId, "upload_audio", {
          status: "failed",
          error: e instanceof Error ? e.message : String(e),
        });
        return;
      }
    } else {
      // local backend, no cloud save requested
      await updateStage(jobId, "upload_audio", { status: "skipped" });
    }
    job = (await fetchJob(jobId))!;
  }

  // ── stage: transcribe ──
  if (job.stages.find((s) => s.key === "transcribe")?.status !== "done") {
    if (resume.mode !== "transcribe" && resume.mode !== "full") {
      await updateStage(jobId, "transcribe", { status: "skipped" });
      return;
    }

    if (backend !== "cobalt") {
      // Local backend already transcribed inside the download polling loop above.
      // If the transcribe stage was already marked "done" by that loop, nothing to do.
      // Otherwise the server didn't produce a transcript (shouldn't happen with mode=transcribe).
      const latestJob = await fetchJob(jobId);
      const transcribeStage = latestJob?.stages.find((s) => s.key === "transcribe");
      if (transcribeStage?.status !== "done") {
        await updateStage(jobId, "transcribe", { status: "skipped" });
      }
      return;
    }

    await updateStage(jobId, "transcribe", { status: "running", percent: 5 });

    const preferredEngine = resume.engine || await getPreferredYoutubeEngine(job.user_id);

    const { data: storedAudio, error: storeError } = await supabase.functions.invoke("youtube-cobalt", {
      body: {
        action: "store_audio",
        url: job.url,
        jobId,
        audioFormat: resume.audioFormat ?? "best",
      },
    });

    if (storeError || !storedAudio?.path) {
      await updateStage(jobId, "transcribe", {
        status: "failed",
        error: `שגיאה בהעברת אודיו לתמלול: ${storeError?.message ?? "audio store failed"}`,
      });
      return;
    }

    await updateStage(jobId, "transcribe", { percent: 12 });

    const engine = preferredEngine;
    const { data: tj, error: tjErr } = await supabase
      .from("transcription_jobs")
      .insert({
        user_id: job.user_id,
        status: "pending",
        engine,
        file_name: storedAudio.fileName ?? `${job.title || "youtube"}.webm`,
        file_path: storedAudio.path,
        language: resume.language ?? "auto",
        progress: 20,
        total_chunks: 1,
        completed_chunks: 0,
        partial_result: "",
      })
      .select("id")
      .single();
    if (tjErr || !tj) {
      await updateStage(jobId, "transcribe", {
        status: "failed",
        error: `יצירת עבודת תמלול נכשלה: ${tjErr?.message ?? "unknown"}`,
      });
      return;
    }
    await updateStage(jobId, "transcribe", {
      percent: 15,
      meta: { transcription_job_id: tj.id, engine },
    });

    // Trigger the edge function (fire-and-forget; row state drives polling)
    supabase.functions.invoke("process-transcription", { body: { jobId: tj.id } }).catch(() => {});

    // Poll the transcription_jobs row and mirror progress
    let lastErr: string | null = null;
    const startedAt = Date.now();
    const timeoutMs = 60 * 60 * 1000; // 1h hard cap
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((r) => setTimeout(r, 3000));
      const { data: row, error: rowErr } = await supabase
        .from("transcription_jobs")
        .select("status, progress, error_message, result_text, total_chunks, completed_chunks")
        .eq("id", tj.id)
        .single();
      if (rowErr) { lastErr = rowErr.message; continue; }
      if (!row) continue;
      const pct = Math.max(15, Math.min(99, row.progress ?? 15));
      const chunkInfo = row.total_chunks && row.total_chunks > 1
        ? { total_chunks: row.total_chunks, completed_chunks: row.completed_chunks ?? 0 }
        : {};

      if (row.status === "completed") {
        try {
          if (row.result_text) {
            await uploadArtifact(job.user_id, jobId, "transcribe", "transcript.txt", row.result_text);
          }
        } catch { /* non-fatal */ }
        await updateStage(jobId, "transcribe", {
          status: "done",
          percent: 100,
          meta: { transcription_job_id: tj.id, engine, chars: row.result_text?.length ?? 0, ...chunkInfo },
        });
        return;
      }
      if (row.status === "failed") {
        await updateStage(jobId, "transcribe", {
          status: "failed",
          error: row.error_message ?? "תמלול נכשל",
        });
        return;
      }
      await updateStage(jobId, "transcribe", { status: "running", percent: pct });
    }
    await updateStage(jobId, "transcribe", {
      status: "failed",
      error: lastErr ?? "התמלול לקח יותר מדי זמן (timeout)",
    });
  }
}
