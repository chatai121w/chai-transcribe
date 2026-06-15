/**
 * Mirrors `transcription_jobs` (the long-running cloud transcription queue)
 * into the central `youtube_jobs` table so the floating Jobs Center shows
 * standalone transcriptions alongside YouTube/convert/cut work.
 *
 * Mapping transcriptionJobId → centralJobId is cached in localStorage so
 * the link survives reloads and resumes.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { trackJob, type JobTracker } from "@/lib/jobs/centralTracker";

const MAP_KEY = "transcribeBridge.map.v1";

type Row = {
  id: string;
  user_id: string;
  file_name: string | null;
  engine: string | null;
  status: string;
  progress: number | null;
  error_message: string | null;
  total_chunks: number | null;
  completed_chunks: number | null;
};

function loadMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(MAP_KEY) || "{}"); } catch { return {}; }
}
function saveMap(m: Record<string, string>) {
  try { localStorage.setItem(MAP_KEY, JSON.stringify(m)); } catch { /* noop */ }
}

export function TranscriptionJobsBridge() {
  const { user } = useAuth();
  const trackersRef = useRef<Map<string, JobTracker>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const mapRef = useRef<Record<string, string>>(loadMap());

  useEffect(() => {
    if (!user) return;

    const handle = async (row: Row) => {
      if (row.user_id !== user.id) return;
      try {
        let tracker = trackersRef.current.get(row.id);
        if (!tracker && !pendingRef.current.has(row.id)) {
          // Skip terminal rows we never tracked — no point creating a record after the fact
          if ((row.status === "completed" || row.status === "failed") && !mapRef.current[row.id]) return;
          pendingRef.current.add(row.id);
          const created = await trackJob({
            kind: "transcribe",
            title: row.file_name ?? "תמלול",
            mode: row.engine ?? "cloud",
            stages: [{ key: "transcribe", label: "תמלול", weight: 100 }],
          });
          pendingRef.current.delete(row.id);
          if (!created) return;
          tracker = created;
          trackersRef.current.set(row.id, tracker);
          mapRef.current[row.id] = created.jobId;
          saveMap(mapRef.current);
        }
        if (!tracker) return;

        const pct = Math.max(0, Math.min(100, row.progress ?? 0));
        const detail = row.total_chunks && row.total_chunks > 1
          ? `${row.completed_chunks ?? 0}/${row.total_chunks} חלקים`
          : undefined;

        if (row.status === "completed") {
          await tracker.stage("transcribe", { status: "done", percent: 100, detail });
        } else if (row.status === "failed") {
          await tracker.stage("transcribe", { status: "failed", error: row.error_message ?? "שגיאת תמלול" });
        } else if (row.status === "uploading" || row.status === "pending" || row.status === "processing") {
          await tracker.stage("transcribe", { status: "running", percent: Math.max(1, Math.min(99, pct)), detail });
        }
      } catch (e) {
        console.warn("[TranscriptionJobsBridge] mirror failed", e);
      }
    };

    // Initial backfill — pick up active jobs
    void (async () => {
      const { data } = await supabase
        .from("transcription_jobs")
        .select("id,user_id,file_name,engine,status,progress,error_message,total_chunks,completed_chunks")
        .eq("user_id", user.id)
        .in("status", ["uploading", "pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(20);
      for (const r of (data ?? []) as Row[]) await handle(r);
    })();

    const channel = supabase
      .channel(`transcribe_bridge_${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "transcription_jobs", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as Row | undefined;
          if (row) void handle(row);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  return null;
}
