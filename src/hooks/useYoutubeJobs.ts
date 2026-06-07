/**
 * useYoutubeJobs — central hook for the YouTube module.
 *
 * Strategy:
 *  1. probeUrl() — try local Flask server first (full yt-dlp), fall back to Cobalt edge function.
 *  2. startJob() — creates a youtube_jobs row, kicks off the chosen backend, returns the job.
 *  3. subscribeToJob() — realtime updates on a specific job row.
 *  4. useYoutubeJobs() — list + realtime feed of the user's jobs (download manager).
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getServerUrl } from "@/lib/serverConfig";

export type YtMode = "transcribe" | "audio" | "video" | "full";
export type YtStatus = "pending" | "downloading" | "extracting" | "converting" | "transcribing" | "finalizing" | "done" | "error" | "cancelled";

export interface YtOutputFile {
  kind: "audio" | "video" | "txt" | "srt" | "vtt" | "json" | "video_with_subs";
  url: string;
  filename: string;
  size?: number;
}

export interface YoutubeJob {
  id: string;
  user_id: string;
  url: string;
  video_title: string | null;
  thumbnail_url: string | null;
  duration_sec: number | null;
  mode: YtMode;
  status: YtStatus;
  progress_pct: number;
  backend: "local" | "cobalt" | null;
  output_files: YtOutputFile[];
  transcript_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface YtProbeResult {
  backend: "local" | "cobalt";
  videoId: string | null;
  title: string | null;
  thumbnail: string | null;
  author?: string | null;
  duration?: number | null;
  hasHebrewSubs?: boolean;
  availableFormats?: Array<{ format_id: string; ext: string; abr?: number; vbr?: number; filesize?: number }>;
}

const YT_REGEX = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w-]+/;

export const isValidYoutubeUrl = (u: string) => YT_REGEX.test(u.trim());

async function probeLocal(url: string, serverUrl: string | null): Promise<YtProbeResult | null> {
  if (!serverUrl) return null;
  try {
    const res = await fetch(`${serverUrl}/yt/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return {
      backend: "local",
      videoId: d.id ?? null,
      title: d.title ?? null,
      thumbnail: d.thumbnail ?? null,
      author: d.uploader ?? null,
      duration: d.duration ?? null,
      hasHebrewSubs: Array.isArray(d.subtitles) && d.subtitles.some((s: string) => s === "he" || s === "iw"),
      availableFormats: d.formats ?? [],
    };
  } catch {
    return null;
  }
}

async function probeCobalt(url: string): Promise<YtProbeResult> {
  const { data, error } = await supabase.functions.invoke("youtube-cobalt", {
    body: { url, action: "info" },
  });
  if (error) throw new Error(error.message);
  return {
    backend: "cobalt",
    videoId: data.videoId ?? null,
    title: data.title ?? null,
    thumbnail: data.thumbnail ?? null,
    author: data.author ?? null,
    hasHebrewSubs: false, // cobalt doesn't expose this
  };
}

export function useYoutubeJobs() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<YoutubeJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    if (!user) {
      setJobs([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from("youtube_jobs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error && data) setJobs(data as unknown as YoutubeJob[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchJobs();
    if (!user) return;
    const channel = supabase
      .channel(`yt_jobs_${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "youtube_jobs", filter: `user_id=eq.${user.id}` }, () => {
        fetchJobs();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchJobs]);

  const probeUrl = useCallback(async (url: string): Promise<YtProbeResult> => {
    if (!isValidYoutubeUrl(url)) throw new Error("קישור YouTube לא תקין");
    const serverUrl = ((): string | null => { try { return getServerUrl(); } catch { return null; } })();
    const local = await probeLocal(url, serverUrl);
    if (local) return local;
    return await probeCobalt(url);
  }, []);

  const startJob = useCallback(
    async (params: {
      url: string;
      mode: YtMode;
      probe: YtProbeResult;
      audioFormat?: "best" | "mp3" | "wav" | "m4a" | "opus";
      videoQuality?: string;
      useExistingCaptions?: boolean;
      attachSubs?: boolean;
      burnSubs?: boolean;
    }): Promise<YoutubeJob> => {
      if (!user) throw new Error("יש להתחבר");
      const { data: inserted, error: insertErr } = await supabase
        .from("youtube_jobs")
        .insert({
          user_id: user.id,
          url: params.url,
          video_title: params.probe.title,
          thumbnail_url: params.probe.thumbnail,
          duration_sec: params.probe.duration ?? null,
          mode: params.mode,
          status: "pending",
          progress_pct: 0,
          backend: params.probe.backend,
        })
        .select("*")
        .single();
      if (insertErr || !inserted) throw new Error(insertErr?.message ?? "שגיאה ביצירת job");
      const job = inserted as unknown as YoutubeJob;

      // Fire off the backend work in the background. Don't await — the realtime
      // subscription will surface progress as the job advances.
      void runJobBackend(job, params).catch(async (e) => {
        await supabase
          .from("youtube_jobs")
          .update({ status: "error", error: e instanceof Error ? e.message : String(e), updated_at: new Date().toISOString() })
          .eq("id", job.id);
      });

      return job;
    },
    [user],
  );

  const deleteJob = useCallback(async (jobId: string) => {
    await supabase.from("youtube_jobs").delete().eq("id", jobId);
  }, []);

  return { jobs, loading, probeUrl, startJob, deleteJob, refetch: fetchJobs };
}

/** Actually execute the backend work for a job. Lives outside the hook so it can run after navigation. */
async function runJobBackend(
  job: YoutubeJob,
  params: {
    url: string;
    mode: YtMode;
    probe: YtProbeResult;
    audioFormat?: "best" | "mp3" | "wav" | "m4a" | "opus";
    videoQuality?: string;
  },
) {
  const update = async (patch: Partial<YoutubeJob>) => {
    await supabase
      .from("youtube_jobs")
      .update({ ...patch, updated_at: new Date().toISOString() } as never)
      .eq("id", job.id);
  };

  await update({ status: "downloading", progress_pct: 10 });

  // Cobalt path — request a stream URL and surface it as an output file.
  if (job.backend === "cobalt") {
    const wantsAudio = params.mode === "audio" || params.mode === "transcribe" || params.mode === "full";
    const wantsVideo = params.mode === "video" || params.mode === "full";

    const outputs: YtOutputFile[] = [];

    if (wantsAudio) {
      const { data, error } = await supabase.functions.invoke("youtube-cobalt", {
        body: {
          url: params.url,
          mode: "audio",
          audioFormat: params.audioFormat ?? "best",
        },
      });
      if (error) throw new Error(error.message);
      if (data?.url) outputs.push({ kind: "audio", url: data.url, filename: data.filename ?? "audio" });
    }
    if (wantsVideo) {
      const { data, error } = await supabase.functions.invoke("youtube-cobalt", {
        body: {
          url: params.url,
          mode: "video",
          videoQuality: params.videoQuality ?? "720",
        },
      });
      if (error) throw new Error(error.message);
      if (data?.url) outputs.push({ kind: "video", url: data.url, filename: data.filename ?? "video.mp4" });
    }

    // Transcription via Cobalt path is not wired here yet — the local server is the supported path.
    // We surface the audio link and mark the job as done so the user can download.
    if (params.mode === "transcribe" || params.mode === "full") {
      await update({
        status: "done",
        progress_pct: 100,
        output_files: outputs as never,
        completed_at: new Date().toISOString(),
        error:
          "תמלול דרך הענן (Cobalt) עדיין לא זמין — האודיו ירד וניתן להעלות אותו ידנית למסך התמלול. הפעל את השרת המקומי לתמלול אוטומטי.",
      });
      return;
    }

    await update({
      status: "done",
      progress_pct: 100,
      output_files: outputs as never,
      completed_at: new Date().toISOString(),
    });
    return;
  }

  // Local Flask path — call /yt/job to kick off, then poll.
  const serverUrl = ((): string | null => { try { return getServerUrl(); } catch { return null; } })();
  if (!serverUrl) throw new Error("שרת מקומי לא זמין");

  const startRes = await fetch(`${serverUrl}/yt/job`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: params.url,
      mode: params.mode,
      audio_format: params.audioFormat ?? "best",
      video_quality: params.videoQuality ?? "720",
    }),
  });
  if (!startRes.ok) throw new Error(`שרת מקומי החזיר ${startRes.status}`);
  const { job_id } = await startRes.json();

  // Poll until done
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    const sRes = await fetch(`${serverUrl}/yt/status/${job_id}`);
    if (!sRes.ok) throw new Error(`status fetch failed: ${sRes.status}`);
    const s = await sRes.json();
    await update({
      status: s.status,
      progress_pct: s.progress_pct ?? 0,
      output_files: (s.output_files ?? []) as never,
    });
    if (s.status === "done") {
      await update({ completed_at: new Date().toISOString() });
      return;
    }
    if (s.status === "error") throw new Error(s.error ?? "Unknown server error");
  }
}
