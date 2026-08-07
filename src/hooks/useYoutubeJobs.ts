/**
 * useYoutubeJobs — central hook for the YouTube module.
 *
 * Strategy:
 *  1. probeUrl() — try local Flask server first (full yt-dlp), fall back to Cobalt edge function.
 *  2. useYoutubeJobs() — list + realtime feed of the user's jobs (download manager).
 * Job execution is owned exclusively by lib/jobs/pipelines/youtubePipeline.
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
  /** Legacy column; the orchestrator writes failures to last_error instead. */
  error: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** Stage list — populated by the job orchestrator (JSONB in DB) */
  stages?: Array<{
    key: string;
    label?: string;
    status: string;
    percent: number;
    weight?: number;
    error?: string | null;
    meta?: {
      server_job_id?: string;
      dl_mb?: number;
      total_mb?: number;
      speed_mb?: number;
      [k: string]: unknown;
    } | null;
  }>;
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
      // Unique per mount: a fixed name collides with the previous mount's
      // channel while it is still tearing down, and the new subscription dies
      // silently — the list then never updates again until a full reload.
      .channel(`yt_jobs_${user.id}_${Math.random().toString(36).slice(2, 10)}`)
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

  const deleteJob = useCallback(async (jobId: string) => {
    await supabase.from("youtube_jobs").delete().eq("id", jobId);
  }, []);

  return { jobs, loading, probeUrl, deleteJob, refetch: fetchJobs };
}
