/**
 * useLoraTraining — client hook for Whisper LoRA fine-tuning on the local GPU server.
 *
 * Mirrors job state to public.lora_training_jobs in Cloud so the user can see
 * history across devices. The actual training runs on the local Flask server
 * (server/train_lora.py spawned via /training/start).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getServerUrl } from '@/lib/serverConfig';
import { toast } from '@/hooks/use-toast';

export interface LoraJob {
  job_id: string;
  status: 'queued' | 'preparing' | 'training' | 'merging' | 'converting' | 'done' | 'failed' | 'cancelled' | 'unknown';
  progress: number;
  current_step?: number;
  total_steps?: number;
  current_epoch?: number;
  train_loss?: number | null;
  eval_loss?: number | null;
  wer_before?: number | null;
  wer_after?: number | null;
  cer_before?: number | null;
  cer_after?: number | null;
  adapter_path?: string | null;
  ct2_model_path?: string | null;
  log_tail?: string;
  error?: string | null;
  updated_at?: number;
}

export interface LoraDataset {
  dataset_id: string;
  count: number;
  has_manifest: boolean;
}

interface StartJobOptions {
  job_name: string;
  dataset_id?: string;
  manifest?: string;
  base_model?: string;
  epochs?: number;
  batch_size?: number;
  lr?: number;
  lora_r?: number;
  lora_alpha?: number;
  lora_dropout?: number;
  merge_and_convert?: boolean;
  max_samples?: number;
}

export function useLoraTraining() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<LoraJob[]>([]);
  const [datasets, setDatasets] = useState<LoraDataset[]>([]);
  const [activeCt2, setActiveCt2] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<number | null>(null);
  const serverMissRef = useRef(0);

  const base = () => getServerUrl().replace(/\/$/, '');

  // ── Cloud mirror ─────────────────────────────────────────────────
  const upsertCloud = useCallback(async (j: LoraJob, opts?: Partial<StartJobOptions>) => {
    if (!user?.id) return;
    try {
      await (supabase as any)
        .from('lora_training_jobs')
        .upsert({
          user_id: user.id,
          job_name: j.job_id,
          base_model: opts?.base_model || 'ivrit-ai/whisper-large-v3',
          status: j.status,
          progress: j.progress ?? 0,
          current_step: j.current_step ?? null,
          total_steps: j.total_steps ?? null,
          current_epoch: j.current_epoch ?? null,
          train_loss: j.train_loss ?? null,
          eval_loss: j.eval_loss ?? null,
          wer_before: j.wer_before ?? null,
          wer_after: j.wer_after ?? null,
          cer_before: j.cer_before ?? null,
          cer_after: j.cer_after ?? null,
          adapter_path: j.adapter_path ?? null,
          ct2_model_path: j.ct2_model_path ?? null,
          log_tail: j.log_tail ?? null,
          error_message: j.error ?? null,
          epochs: opts?.epochs ?? 3,
          batch_size: opts?.batch_size ?? 8,
          learning_rate: opts?.lr ?? 0.0001,
          lora_r: opts?.lora_r ?? 32,
          lora_alpha: opts?.lora_alpha ?? 64,
          lora_dropout: opts?.lora_dropout ?? 0.05,
          dataset_size: (opts as any)?.dataset_size ?? 0,
          finished_at: (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled')
            ? new Date().toISOString() : null,
        }, { onConflict: 'user_id,job_name' as any });
    } catch (e) {
      console.warn('[lora] cloud mirror failed', e);
    }
  }, [user?.id]);

  // ── Server fetches ───────────────────────────────────────────────
  const refreshJobs = useCallback(async () => {
    try {
      const res = await fetch(`${base()}/training/jobs`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      serverMissRef.current = 0;
      setJobs(data.jobs || []);
    } catch {
      // After 5 consecutive missed polls (~15s), mark active jobs as unknown
      // so the UI doesn't show stale "preparing"/"training" forever.
      serverMissRef.current += 1;
      if (serverMissRef.current >= 5) {
        setJobs(prev =>
          prev.map(j =>
            ['preparing', 'training', 'merging', 'converting'].includes(j.status)
              ? { ...j, status: 'unknown' as LoraJob['status'] }
              : j
          )
        );
      }
    }
  }, []);

  const refreshDatasets = useCallback(async () => {
    try {
      const res = await fetch(`${base()}/training/datasets`);
      if (!res.ok) return;
      const data = await res.json();
      setDatasets(data.datasets || []);
    } catch { /* offline */ }
  }, []);

  const refreshActiveModel = useCallback(async () => {
    try {
      const res = await fetch(`${base()}/training/active-model`);
      if (!res.ok) return;
      const data = await res.json();
      setActiveCt2(data.active || null);
    } catch { /* offline */ }
  }, []);

  // ── Dataset management ───────────────────────────────────────────
  const createDataset = useCallback(async (name: string) => {
    const res = await fetch(`${base()}/training/dataset/new`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`createDataset failed: ${res.status}`);
    await refreshDatasets();
    return (await res.json()).dataset_id as string;
  }, [refreshDatasets]);

  const uploadPair = useCallback(async (datasetId: string, audio: File, text: string) => {
    const fd = new FormData();
    fd.append('dataset_id', datasetId);
    fd.append('audio', audio, audio.name);
    fd.append('text', text);
    const res = await fetch(`${base()}/training/dataset/upload-pair`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`uploadPair failed: ${res.status}`);
    return res.json();
  }, []);

  const finalizeDataset = useCallback(async (datasetId: string) => {
    const res = await fetch(`${base()}/training/dataset/${datasetId}/finalize`, { method: 'POST' });
    if (!res.ok) throw new Error(`finalize failed: ${res.status}`);
    const data = await res.json();
    await refreshDatasets();
    return data as { manifest: string; rows: number };
  }, [refreshDatasets]);

  // ── Job control ─────────────────────────────────────────────────
  const startJob = useCallback(async (opts: StartJobOptions) => {
    const res = await fetch(`${base()}/training/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`start failed: ${res.status} ${txt}`);
    }
    const data = await res.json();
    toast({ title: '🎓 אימון התחיל', description: `Job: ${data.job_id} | PID: ${data.pid}` });
    await refreshJobs();
    setPolling(true);
    // Seed the cloud row immediately so the user sees it in history
    await upsertCloud({ job_id: data.job_id, status: 'preparing', progress: 0 }, opts);
    return data.job_id as string;
  }, [refreshJobs, upsertCloud]);

  const cancelJob = useCallback(async (jobId: string) => {
    const res = await fetch(`${base()}/training/cancel/${jobId}`, { method: 'POST' });
    if (!res.ok) throw new Error(`cancel failed: ${res.status}`);
    await refreshJobs();
  }, [refreshJobs]);

  const setActiveModel = useCallback(async (ct2Path: string | null) => {
    const res = await fetch(`${base()}/training/set-active-model`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ct2_path: ct2Path }),
    });
    if (!res.ok) throw new Error(`set active failed: ${res.status}`);
    await refreshActiveModel();
    toast({
      title: ct2Path ? '✅ מודל מאומן מופעל' : 'מודל בסיס שוחזר',
      description: ct2Path || 'המערכת תשתמש שוב במודל ה-Whisper הרגיל',
    });
  }, [refreshActiveModel]);

  // ── Polling for live progress ───────────────────────────────────
  useEffect(() => {
    if (!polling) return;
    pollRef.current = window.setInterval(refreshJobs, 3000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [polling, refreshJobs]);

  // Mirror live updates to cloud (only when something is moving)
  useEffect(() => {
    for (const j of jobs) {
      if (['training', 'preparing', 'merging', 'converting', 'done', 'failed', 'cancelled'].includes(j.status)) {
        upsertCloud(j);
      }
    }
    // If no active jobs, stop polling
    if (polling && !jobs.some(j => ['training', 'preparing', 'merging', 'converting'].includes(j.status))) {
      setPolling(false);
    }
  }, [jobs, polling, upsertCloud]);

  useEffect(() => {
    refreshJobs();
    refreshDatasets();
    refreshActiveModel();
  }, [refreshJobs, refreshDatasets, refreshActiveModel]);

  return {
    jobs, datasets, activeCt2, polling,
    refreshJobs, refreshDatasets, refreshActiveModel,
    createDataset, uploadPair, finalizeDataset,
    startJob, cancelJob, setActiveModel,
  };
}
