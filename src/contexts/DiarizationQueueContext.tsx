import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { diarizeInBrowser, type DiarizationProgress } from '@/utils/browserDiarization';
import { db, isDbAvailable } from '@/lib/localDb';

/* eslint-disable react-refresh/only-export-components */

// ─── Types ───

export type DiarizationMode = 'local' | 'assemblyai' | 'deepgram' | 'openai' | 'browser' | 'whisperx';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'error';

export interface DiarizedSegment {
  text: string;
  start: number;
  end: number;
  speaker: string;
  speaker_label: string;
  words?: Array<{ word: string; start: number; end: number; probability: number }>;
}

export interface DiarizationResult {
  text: string;
  segments: DiarizedSegment[];
  speakers: string[];
  speaker_count: number;
  duration: number;
  processing_time: number;
  diarization_method: string;
}

export interface QueueJob {
  id: string;
  fileName: string;
  mode: DiarizationMode;
  status: JobStatus;
  progress: number;
  progressStage: string;
  result: DiarizationResult | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
  cloudSaveId: string | null;
  audioUrl: string | null;
}

interface QueueConfig {
  serverUrl: string;
  minGap: number;
  hfToken: string;
  pyannoteModel: '3.1' | 'community-1';
  expectedSpeakers: number;
  cloudApiKey: string;
  autoSaveToCloud: boolean;
}

interface OpenAiWord {
  word?: string;
  start?: number;
  end?: number;
}

interface OpenAiSegment {
  text?: string;
  start?: number;
  end?: number;
  words?: OpenAiWord[];
}

interface OpenAiTranscriptionResponse {
  text?: string;
  duration?: number;
  segments?: OpenAiSegment[];
}

interface LooseInsertSingleResult {
  data: { id?: string } | null;
  error: unknown;
}

interface LooseDiarizationInsertQuery {
  insert: (payload: unknown) => {
    select: (columns: string) => {
      single: () => Promise<LooseInsertSingleResult>;
    };
  };
}

interface LooseSupabaseClient {
  from: (table: string) => LooseDiarizationInsertQuery;
}

interface DiarizationQueueContextValue {
  jobs: QueueJob[];
  activeCount: number;
  completedCount: number;
  enqueue: (file: File, mode: DiarizationMode, config: Partial<QueueConfig>) => string;
  enqueueMultiple: (files: File[], mode: DiarizationMode, config: Partial<QueueConfig>) => string[];
  cancelJob: (jobId: string) => void;
  retryJob: (jobId: string) => void;
  removeJob: (jobId: string) => void;
  clearCompleted: () => void;
  getJob: (jobId: string) => QueueJob | undefined;
  maxConcurrent: number;
  setMaxConcurrent: (n: number) => void;
}

const DiarizationQueueContext = createContext<DiarizationQueueContextValue | null>(null);

// ─── Storage Keys ───

const STORAGE_KEY = 'diarization_queue_jobs';
const STORAGE_CONFIG_KEY = 'diarization_queue_config';
const JOB_FILE_PREFIX = 'dq_file_';

function generateId(): string {
  return `dj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadPersistedJobs(): QueueJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const jobs: QueueJob[] = JSON.parse(raw);
    // Keep jobs resumable after refresh/restart.
    return jobs.map(j => j.status === 'processing' || j.status === 'queued'
      ? { ...j, status: 'queued' as JobStatus, error: null, progressStage: 'שוחזר אחרי רענון — ממתין להמשך' }
      : j
    ).filter(j => Date.now() - j.createdAt < 7 * 24 * 3600 * 1000); // keep 7 days
  } catch { return []; }
}

function loadPersistedConfig(): { maxConcurrent: number } {
  try {
    const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
    if (!raw) return { maxConcurrent: 2 };
    const parsed = JSON.parse(raw) as { maxConcurrent?: number };
    const maxConcurrent = Number(parsed.maxConcurrent ?? 2);
    return { maxConcurrent: Number.isFinite(maxConcurrent) ? Math.min(4, Math.max(1, maxConcurrent)) : 2 };
  } catch {
    return { maxConcurrent: 2 };
  }
}

function persistConfig(config: { maxConcurrent: number }) {
  try {
    localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

function persistJobs(jobs: QueueJob[]) {
  try {
    // Don't persist result data (too large), only metadata
    const lite = jobs.map(j => ({
      ...j,
      result: j.result ? { text: '', segments: [], speakers: j.result.speakers, speaker_count: j.result.speaker_count,
        duration: j.result.duration, processing_time: j.result.processing_time, diarization_method: j.result.diarization_method } : null,
      audioUrl: null, // blob URLs don't survive refresh
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lite));
  } catch { /* quota exceeded — ignore */ }
}

// ─── Provider ───

export function DiarizationQueueProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<QueueJob[]>(loadPersistedJobs);
  const [maxConcurrent, setMaxConcurrent] = useState(loadPersistedConfig().maxConcurrent);
  const jobFilesRef = useRef<Map<string, File>>(new Map());
  const jobConfigsRef = useRef<Map<string, QueueConfig>>(new Map());
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const executeJobRef = useRef<(jobId: string) => void>(() => {});
  const processingRef = useRef(false);
  const restoredRef = useRef(false);

  // Persist jobs to localStorage on change
  useEffect(() => { persistJobs(jobs); }, [jobs]);
  useEffect(() => { persistConfig({ maxConcurrent }); }, [maxConcurrent]);

  const persistJobFile = useCallback(async (jobId: string, file: File) => {
    if (!(await isDbAvailable())) return;
    try {
      await db.audioBlobs.put({
        id: `${JOB_FILE_PREFIX}${jobId}`,
        blob: file,
        type: file.type,
        name: file.name,
        saved_at: Date.now(),
      });
    } catch {
      // ignore persistence failures; queue still works in-memory
    }
  }, []);

  const removeJobFile = useCallback(async (jobId: string) => {
    if (!(await isDbAvailable())) return;
    try {
      await db.audioBlobs.delete(`${JOB_FILE_PREFIX}${jobId}`);
    } catch { /* ignore */ }
  }, []);

  const restoreJobFile = useCallback(async (jobId: string): Promise<File | null> => {
    if (!(await isDbAvailable())) return null;
    try {
      const rec = await db.audioBlobs.get(`${JOB_FILE_PREFIX}${jobId}`);
      if (!rec) return null;
      return new File([rec.blob], rec.name || `job-${jobId}.audio`, { type: rec.type || rec.blob.type || 'audio/wav' });
    } catch {
      return null;
    }
  }, []);

  // ─── Core: Process Queue ───

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    try {
      while (true) {
        // Get current state snapshot
        let currentJobs: QueueJob[] = [];
        setJobs(prev => { currentJobs = prev; return prev; });
        // Wait a tick for state to settle
        await new Promise(r => setTimeout(r, 10));
        setJobs(prev => { currentJobs = prev; return prev; });

        const activeJobs = currentJobs.filter(j => j.status === 'processing');
        const queuedJobs = currentJobs.filter(j => j.status === 'queued');

        if (queuedJobs.length === 0) break;
        if (activeJobs.length >= maxConcurrent) break;

        const slotsAvailable = maxConcurrent - activeJobs.length;
        const toStart = queuedJobs.slice(0, slotsAvailable);

        for (const job of toStart) {
          // Mark as processing
          setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'processing' as JobStatus, progress: 0, progressStage: 'מתחיל...' } : j));
          // Launch processing (fire-and-forget, each manages its own state)
          executeJobRef.current(job.id);
        }
        // Wait before checking again
        await new Promise(r => setTimeout(r, 200));
      }
    } finally {
      processingRef.current = false;
    }
  }, [maxConcurrent]);

  // Rehydrate queued job files after refresh and continue automatically.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const restore = async () => {
      const resumable = jobs.filter(j => j.status === 'queued');
      if (resumable.length === 0) return;

      const missing: string[] = [];
      for (const job of resumable) {
        const restored = await restoreJobFile(job.id);
        if (restored) {
          jobFilesRef.current.set(job.id, restored);
        } else {
          missing.push(job.id);
        }
      }

      if (missing.length > 0) {
        setJobs(prev => prev.map(j => missing.includes(j.id)
          ? { ...j, status: 'error' as JobStatus, error: 'קובץ מקור לא נמצא לשחזור — יש להעלות מחדש', progress: 0, progressStage: '' }
          : j));
      }

      const restoredCount = resumable.length - missing.length;
      if (restoredCount > 0) {
        setTimeout(() => processQueue(), 80);
        toast({ title: 'שוחזר עיבוד רקע', description: `${restoredCount} משימות הוחזרו וימשיכו אוטומטית` });
      }
    };

    void restore();
  }, [restoreJobFile, processQueue, jobs]);

  const updateJob = useCallback((jobId: string, updates: Partial<QueueJob>) => {
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, ...updates } : j));
  }, []);

  const autoSaveToCloud = useCallback(async (jobId: string, result: DiarizationResult, fileName: string, mode: DiarizationMode) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const looseSupabase = supabase as unknown as LooseSupabaseClient;
      const { data, error } = await looseSupabase.from('diarization_results').insert({
        user_id: user.id,
        file_name: fileName,
        segments: result.segments,
        speakers: result.speakers,
        speaker_names: {},
        speaker_count: result.speaker_count,
        duration: result.duration,
        processing_time: result.processing_time,
        diarization_method: result.diarization_method,
        engine: mode,
      }).select('id').single();
      if (error) throw error;
      return data?.id || null;
    } catch (err) {
      console.error('Auto-save to cloud failed:', err);
      return null;
    }
  }, []);

  // ─── Execute a Single Job ───

  const executeJob = useCallback(async (jobId: string) => {
    const config = jobConfigsRef.current.get(jobId) || {} as QueueConfig;

    let currentJob: QueueJob | undefined;
    setJobs(prev => { currentJob = prev.find(j => j.id === jobId); return prev; });
    await new Promise(r => setTimeout(r, 10));
    setJobs(prev => { currentJob = prev.find(j => j.id === jobId); return prev; });

    if (!currentJob) {
      updateJob(jobId, { status: 'error', error: 'משימה לא נמצאה' });
      return;
    }

    let file = jobFilesRef.current.get(jobId) || null;
    if (!file) {
      file = await restoreJobFile(jobId);
      if (file) jobFilesRef.current.set(jobId, file);
    }

    if (!file) {
      updateJob(jobId, { status: 'error', error: 'קובץ לא נמצא — יש להעלות מחדש' });
      return;
    }

    const mode = currentJob.mode;
    const serverUrl = config.serverUrl || '/whisper';
    const abortController = new AbortController();
    abortControllersRef.current.set(jobId, abortController);

    // Create audio URL
    const audioUrl = URL.createObjectURL(file);
    updateJob(jobId, { audioUrl });

    try {
      let result: DiarizationResult;

      if (mode === 'browser') {
        const data = await diarizeInBrowser(file, (p: DiarizationProgress) => {
          if (abortController.signal.aborted) throw new Error('בוטל');
          updateJob(jobId, { progress: p.percent, progressStage: p.stage });
        }, config.expectedSpeakers || undefined);
        result = { text: data.segments.map(s => s.text).join(" "), ...data };

      } else if (mode === 'local' || mode === 'whisperx') {
        updateJob(jobId, { progress: 10, progressStage: 'מעלה לשרת...' });
        const formData = new FormData();
        formData.append("file", file);
        formData.append("min_gap", (config.minGap || 1.5).toString());
        if (mode === 'local') {
          const localHf = config.hfToken?.trim() || '';
          formData.append("diarization_engine", localHf ? "pyannote" : "silence-gap");
          if (localHf) {
            formData.append("hf_token", localHf);
            formData.append("pyannote_model", config.pyannoteModel === '3.1' ? 'pyannote/speaker-diarization-3.1' : 'pyannote/speaker-diarization-community-1');
          }
        }
        if (mode === 'whisperx') {
          formData.append("use_whisperx", "1");
          formData.append("diarization_engine", "whisperx");
          const wxHf = config.hfToken?.trim() || '';
          if (wxHf) {
            formData.append("hf_token", wxHf);
            formData.append("pyannote_model", config.pyannoteModel === '3.1' ? 'pyannote/speaker-diarization-3.1' : 'pyannote/speaker-diarization-community-1');
          }
        }
        updateJob(jobId, { progress: 20, progressStage: 'מתחיל עיבוד בשרת...' });
        const resp = await fetch(`${serverUrl}/diarize-stream`, { method: "POST", body: formData, signal: abortController.signal });
        if (!resp.ok || !resp.body) {
          const err = await resp.json().catch(() => ({ error: "Server error" }));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let finalResult: DiarizationResult | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'progress') {
                updateJob(jobId, {
                  progress: Number(event.percent) || 0,
                  progressStage: event.stage || 'מעבד בשרת...',
                });
              } else if (event.type === 'segment') {
                const pct = Number(event.percent) || 0;
                updateJob(jobId, {
                  progress: pct,
                  progressStage: `קטע ${Number(event.index) + 1}/${Number(event.total) || '?'}...`,
                });
              } else if (event.type === 'done') {
                finalResult = event as DiarizationResult;
              } else if (event.type === 'error') {
                throw new Error(event.error || 'Stream error');
              }
            } catch (parseErr) {
              if (parseErr instanceof Error && parseErr.message !== 'Unexpected end of JSON input') {
                throw parseErr;
              }
            }
          }
        }

        if (!finalResult) {
          throw new Error('השרת לא החזיר תוצאה מלאה');
        }
        result = finalResult;

      } else if (mode === 'openai') {
        if (!config.cloudApiKey?.trim()) throw new Error("נדרש מפתח API של OpenAI");
        updateJob(jobId, { progress: 10, progressStage: 'שולח ל-OpenAI...' });
        const formData = new FormData();
        formData.append("file", file);
        formData.append("model", "whisper-1");
        formData.append("language", "he");
        formData.append("response_format", "verbose_json");
        formData.append("timestamp_granularities[]", "segment");
        formData.append("timestamp_granularities[]", "word");
        const startTime = Date.now();
        const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${config.cloudApiKey.trim()}` },
          body: formData,
          signal: abortController.signal,
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "OpenAI error" }));
          throw new Error(err.error?.message || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const openAiData = data as OpenAiTranscriptionResponse;
        const processingTime = (Date.now() - startTime) / 1000;
        const segments: DiarizedSegment[] = (openAiData.segments || []).map((seg, i: number) => ({
          text: seg.text?.trim() || "", start: seg.start || 0, end: seg.end || 0,
          speaker: `Speaker ${i % 2 + 1}`, speaker_label: `דובר ${i % 2 + 1}`,
          words: seg.words?.map((w) => ({ word: w.word || '', start: w.start || 0, end: w.end || 0, probability: 1 })),
        }));
        let currentSpeaker = 1;
        for (let i = 1; i < segments.length; i++) {
          const gap = segments[i].start - segments[i - 1].end;
          if (gap > 1.5) currentSpeaker = currentSpeaker === 1 ? 2 : 1;
          segments[i].speaker = `Speaker ${currentSpeaker}`;
          segments[i].speaker_label = `דובר ${currentSpeaker}`;
        }
        const speakers = [...new Set(segments.map(s => s.speaker_label))];
        result = {
          text: openAiData.text || "", segments, speakers,
          speaker_count: speakers.length,
          duration: segments.length > 0 ? segments[segments.length - 1].end : openAiData.duration || 0,
          processing_time: Math.round(processingTime * 10) / 10,
          diarization_method: "OpenAI Whisper + gap-detection",
        };
      } else {
        // AssemblyAI / Deepgram via Supabase edge function
        if (!config.cloudApiKey?.trim()) throw new Error(`נדרש מפתח API של ${mode === 'assemblyai' ? 'AssemblyAI' : 'Deepgram'}`);
        updateJob(jobId, { progress: 10, progressStage: `שולח ל-${mode === 'assemblyai' ? 'AssemblyAI' : 'Deepgram'}...` });
        const formData = new FormData();
        formData.append("file", file);
        formData.append("engine", mode);
        formData.append("apiKey", config.cloudApiKey.trim());
        formData.append("language", "he");
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const fnUrl = `https://${projectId}.supabase.co/functions/v1/diarize-cloud`;
        updateJob(jobId, { progress: 30, progressStage: 'ממתין לתוצאות...' });
        const resp = await fetch(fnUrl, { method: "POST", headers: { apikey: anonKey }, body: formData, signal: abortController.signal });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: "Cloud error" }));
          throw new Error(err.error || `HTTP ${resp.status}`);
        }
        result = await resp.json();
      }

      // ─── Job Completed Successfully ───
      updateJob(jobId, { status: 'completed', progress: 100, progressStage: 'הושלם!', result, completedAt: Date.now() });
      void removeJobFile(jobId);

      // Auto-save to cloud
      if (config.autoSaveToCloud !== false) {
        const cloudId = await autoSaveToCloud(jobId, result, currentJob.fileName, mode);
        if (cloudId) updateJob(jobId, { cloudSaveId: cloudId });
      }

      toast({
        title: `✅ ${currentJob.fileName}`,
        description: `${result.speaker_count} דוברים זוהו — ${result.diarization_method}`,
      });

    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        updateJob(jobId, { status: 'error', error: 'בוטל על ידי המשתמש', progress: 0, progressStage: '' });
      } else {
        const message = err instanceof Error ? err.message : 'שגיאה לא ידועה';
        updateJob(jobId, { status: 'error', error: message, progress: 0, progressStage: '' });
        toast({ title: `❌ שגיאה — ${currentJob.fileName}`, description: message, variant: 'destructive' });
      }
    } finally {
      abortControllersRef.current.delete(jobId);
      // Trigger queue processing for next jobs
      setTimeout(() => processQueue(), 100);
    }
  }, [updateJob, autoSaveToCloud, processQueue, restoreJobFile, removeJobFile]);

  useEffect(() => {
    executeJobRef.current = (jobId: string) => {
      void executeJob(jobId);
    };
  }, [executeJob]);

  // ─── Public API ───

  const enqueue = useCallback((file: File, mode: DiarizationMode, config: Partial<QueueConfig> = {}): string => {
    const id = generateId();
    const job: QueueJob = {
      id,
      fileName: file.name,
      mode,
      status: 'queued',
      progress: 0,
      progressStage: 'בתור...',
      result: null,
      error: null,
      createdAt: Date.now(),
      completedAt: null,
      cloudSaveId: null,
      audioUrl: null,
    };
    jobFilesRef.current.set(id, file);
    void persistJobFile(id, file);
    jobConfigsRef.current.set(id, {
      serverUrl: config.serverUrl || '/whisper',
      minGap: config.minGap ?? 1.5,
      hfToken: config.hfToken || '',
      pyannoteModel: config.pyannoteModel || 'community-1',
      expectedSpeakers: config.expectedSpeakers ?? 0,
      cloudApiKey: config.cloudApiKey || '',
      autoSaveToCloud: config.autoSaveToCloud ?? true,
    });
    setJobs(prev => [job, ...prev]);
    setTimeout(() => processQueue(), 50);
    return id;
  }, [processQueue, persistJobFile]);

  const enqueueMultiple = useCallback((files: File[], mode: DiarizationMode, config: Partial<QueueConfig> = {}): string[] => {
    const ids: string[] = [];
    const newJobs: QueueJob[] = [];
    for (const file of files) {
      const id = generateId();
      ids.push(id);
      jobFilesRef.current.set(id, file);
      void persistJobFile(id, file);
      jobConfigsRef.current.set(id, {
        serverUrl: config.serverUrl || '/whisper',
        minGap: config.minGap ?? 1.5,
        hfToken: config.hfToken || '',
        pyannoteModel: config.pyannoteModel || 'community-1',
        expectedSpeakers: config.expectedSpeakers ?? 0,
        cloudApiKey: config.cloudApiKey || '',
        autoSaveToCloud: config.autoSaveToCloud ?? true,
      });
      newJobs.push({
        id,
        fileName: file.name,
        mode,
        status: 'queued',
        progress: 0,
        progressStage: 'בתור...',
        result: null,
        error: null,
        createdAt: Date.now(),
        completedAt: null,
        cloudSaveId: null,
        audioUrl: null,
      });
    }
    setJobs(prev => [...newJobs, ...prev]);
    toast({ title: `📋 ${files.length} קבצים נוספו לתור`, description: `מנוע: ${mode}` });
    setTimeout(() => processQueue(), 50);
    return ids;
  }, [processQueue, persistJobFile]);

  const cancelJob = useCallback((jobId: string) => {
    const controller = abortControllersRef.current.get(jobId);
    if (controller) controller.abort();
    updateJob(jobId, { status: 'error', error: 'בוטל', progress: 0, progressStage: '' });
  }, [updateJob]);

  const retryJob = useCallback((jobId: string) => {
    const file = jobFilesRef.current.get(jobId);
    if (!file) {
      toast({ title: 'קובץ לא נמצא', description: 'יש להעלות את הקובץ מחדש', variant: 'destructive' });
      return;
    }
    updateJob(jobId, { status: 'queued', error: null, progress: 0, progressStage: 'בתור...', result: null, cloudSaveId: null });
    setTimeout(() => processQueue(), 50);
  }, [updateJob, processQueue]);

  const removeJob = useCallback((jobId: string) => {
    const controller = abortControllersRef.current.get(jobId);
    if (controller) controller.abort();
    jobFilesRef.current.delete(jobId);
    jobConfigsRef.current.delete(jobId);
    abortControllersRef.current.delete(jobId);
    void removeJobFile(jobId);
    setJobs(prev => prev.filter(j => j.id !== jobId));
  }, [removeJobFile]);

  const clearCompleted = useCallback(() => {
    setJobs(prev => {
      const toRemove = prev.filter(j => j.status === 'completed');
      toRemove.forEach(j => {
        jobFilesRef.current.delete(j.id);
        jobConfigsRef.current.delete(j.id);
        if (j.audioUrl) URL.revokeObjectURL(j.audioUrl);
        void removeJobFile(j.id);
      });
      return prev.filter(j => j.status !== 'completed');
    });
  }, [removeJobFile]);

  const getJob = useCallback((jobId: string) => jobs.find(j => j.id === jobId), [jobs]);

  const activeCount = jobs.filter(j => j.status === 'processing' || j.status === 'queued').length;
  const completedCount = jobs.filter(j => j.status === 'completed').length;

  return (
    <DiarizationQueueContext.Provider value={{
      jobs, activeCount, completedCount,
      enqueue, enqueueMultiple, cancelJob, retryJob, removeJob, clearCompleted, getJob,
      maxConcurrent, setMaxConcurrent,
    }}>
      {children}
    </DiarizationQueueContext.Provider>
  );
}

export function useDiarizationQueue() {
  const ctx = useContext(DiarizationQueueContext);
  if (!ctx) throw new Error('useDiarizationQueue must be used within DiarizationQueueProvider');
  return ctx;
}

/** Safe version — returns null when outside provider (no throw) */
export function useDiarizationQueueOptional() {
  return useContext(DiarizationQueueContext);
}
