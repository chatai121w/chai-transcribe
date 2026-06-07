/**
 * Mirrors local FFmpeg conversion jobs into the central jobs table so
 * the floating Jobs Center shows them next to YouTube / cut / transcribe.
 *
 * Listens to `onJobUpdate` from ffmpegConverter and creates / updates a
 * matching `youtube_jobs` row per local job (one stage: "convert").
 */
import { useEffect, useRef } from "react";
import { onJobUpdate, type ConversionJob } from "@/lib/ffmpegConverter";
import { trackJob, type JobTracker } from "@/lib/jobs/centralTracker";

export function ConversionJobsBridge() {
  const trackersRef = useRef<Map<string, JobTracker>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const off = onJobUpdate(async (job: ConversionJob) => {
      try {
        let tracker = trackersRef.current.get(job.id);
        if (!tracker && !pendingRef.current.has(job.id)) {
          pendingRef.current.add(job.id);
          const created = await trackJob({
            kind: "convert",
            title: job.fileName,
            mode: job.outputFormat,
            stages: [{ key: "convert", label: "המרה", weight: 100 }],
          });
          pendingRef.current.delete(job.id);
          if (!created) return;
          tracker = created;
          trackersRef.current.set(job.id, tracker);
        }
        if (!tracker) return;

        if (job.status === "queued") {
          await tracker.stage("convert", { status: "pending", percent: 0 });
        } else if (job.status === "converting" || job.status === "loading") {
          await tracker.stage("convert", {
            status: "running",
            percent: Math.max(1, Math.min(99, job.progress)),
          });
        } else if (job.status === "done") {
          await tracker.stage("convert", { status: "done", percent: 100 });
        } else if (job.status === "error") {
          await tracker.stage("convert", { status: "failed", error: job.error ?? "שגיאה" });
        }
      } catch (e) {
        console.warn("[ConversionJobsBridge] mirror failed", e);
      }
    });
    return () => { off(); };
  }, []);

  return null;
}
