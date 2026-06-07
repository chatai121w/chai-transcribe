import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { JobRecord } from "@/lib/jobs/types";

export function useJobs() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    if (!user) {
      setJobs([]);
      setLoading(false);
      return;
    }
    const { data } = await supabase
      .from("youtube_jobs")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100);
    setJobs((data ?? []) as unknown as JobRecord[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchJobs();
    if (!user) return;
    const channel = supabase
      .channel(`jobs_center_${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "youtube_jobs", filter: `user_id=eq.${user.id}` },
        () => fetchJobs(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchJobs]);

  const activeCount = jobs.filter((j) => j.status === "running" || j.status === "pending").length;

  return { jobs, loading, activeCount, refetch: fetchJobs };
}

export function useJob(jobId: string | null) {
  const [job, setJob] = useState<JobRecord | null>(null);

  const fetchOne = useCallback(async () => {
    if (!jobId) {
      setJob(null);
      return;
    }
    const { data } = await supabase.from("youtube_jobs").select("*").eq("id", jobId).maybeSingle();
    setJob((data ?? null) as unknown as JobRecord | null);
  }, [jobId]);

  useEffect(() => {
    fetchOne();
    if (!jobId) return;
    const channel = supabase
      .channel(`job_${jobId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "youtube_jobs", filter: `id=eq.${jobId}` },
        () => fetchOne(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, fetchOne]);

  return { job, refetch: fetchOne };
}
