import { useState, useEffect, useCallback, useRef } from 'react';
import { debugLog } from '@/lib/debugLogger';
import { getApiKey } from '@/lib/keyCrypto';
import { normalizeServerUrl, getServerUrl, DEFAULT_SERVER_URL } from '@/lib/serverConfig';

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface ServerTranscriptionResult {
  text: string;
  wordTimings: WordTiming[];
  duration?: number;
  language?: string;
  model?: string;
  processing_time?: number;
  stats?: TranscriptionStats;
}

export interface TranscriptionStats {
  rtf: number;              // Real-Time Factor (processing_time / audio_duration)
  file_size: number;        // bytes
  compute_type: string;
  beam_size: number;
  fast_mode: boolean;
  processing_time: number;
  duration: number;
}

export interface CudaOptions {
  preset?: string;              // 'fast' | 'balanced' | 'accurate' — server-side preset
  fastMode?: boolean;
  computeType?: string;         // 'float16' | 'int8_float16' | 'int8'
  beamSize?: number;            // 1-5
  noConditionOnPrevious?: boolean;
  vadAggressive?: boolean;
  hotwords?: string;            // comma-separated hotwords for improved recognition
  paragraphThreshold?: number;  // seconds of silence to trigger paragraph break (0=off)
  initialPrompt?: string;       // free-form context prompt fed to Whisper decoder
  loshonKodesh?: boolean;       // when true, server merges torani prompt + hotwords automatically
}

export interface PartialTranscript {
  text: string;
  wordTimings: WordTiming[];
  progress: number;         // 0-100 real percentage
  audioDuration?: number;
  lastSegEnd?: number;       // last segment end time in seconds (for resume)
}

interface ServerStatus {
  status: string;
  device: string;
  gpu: string | null;
  current_model: string | null;
  cached_models: string[];
  downloaded_models: string[];
  available_models: string[];
  model_loading: boolean;
  model_loading_id: string | null;
  model_ready: boolean;
}

/** Key used to persist partial transcription in localStorage */
const PARTIAL_STORAGE_KEY = 'transcription_partial';

/** Debounced localStorage write — max once per 2 seconds */
let _partialSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _lastPartialSaved = 0;
function savePartialDebounced(partial: any) {
  const now = Date.now();
  if (now - _lastPartialSaved >= 2000) {
    localStorage.setItem(PARTIAL_STORAGE_KEY, JSON.stringify(partial));
    _lastPartialSaved = now;
    if (_partialSaveTimer) { clearTimeout(_partialSaveTimer); _partialSaveTimer = null; }
  } else if (!_partialSaveTimer) {
    _partialSaveTimer = setTimeout(() => {
      localStorage.setItem(PARTIAL_STORAGE_KEY, JSON.stringify(partial));
      _lastPartialSaved = Date.now();
      _partialSaveTimer = null;
    }, 2000 - (now - _lastPartialSaved));
  }
}

export type TranscriptionPhase = 'idle' | 'loading-model' | 'transcribing';

// ── Client-side serialization queue ──
// The Whisper server has GPU concurrency = 1; sending parallel requests just
// causes 503s. We chain transcription requests on the client so the UI can
// queue up multiple files without hitting OOM or busy errors.
let _transcribeQueueTail: Promise<unknown> = Promise.resolve();
let _transcribeQueueDepth = 0;
type QueueListener = (depth: number) => void;
const _queueListeners = new Set<QueueListener>();
export function getTranscribeQueueDepth(): number {
  return _transcribeQueueDepth;
}
export function subscribeTranscribeQueue(fn: QueueListener): () => void {
  _queueListeners.add(fn);
  fn(_transcribeQueueDepth);
  return () => { _queueListeners.delete(fn); };
}
function _notifyQueue() {
  for (const fn of _queueListeners) {
    try { fn(_transcribeQueueDepth); } catch { /* ignore */ }
  }
}
function enqueueTranscription<T>(task: () => Promise<T>): Promise<T> {
  _transcribeQueueDepth++;
  _notifyQueue();
  const next = _transcribeQueueTail.then(task, task);
  _transcribeQueueTail = next.catch(() => undefined).finally(() => {
    _transcribeQueueDepth = Math.max(0, _transcribeQueueDepth - 1);
    _notifyQueue();
  });
  return next as Promise<T>;
}

export const useLocalServer = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<TranscriptionPhase>('idle');
  const [partialTranscript, setPartialTranscript] = useState<PartialTranscript | null>(null);
  const [audioDurationSec, setAudioDurationSec] = useState<number>(0);   // total audio duration (from server 'info' event)
  const [audioProcessedSec, setAudioProcessedSec] = useState<number>(0); // audio seconds already transcribed (from segment 'segEnd')
  const [modelReady, setModelReady] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  const abortRef = useRef<AbortController | null>(null);
  const preloadAbortRef = useRef<AbortController | null>(null);

  const getBaseUrl = () => {
    // Prefer decrypted in-memory value (handles encrypted CloudKeySync values)
    const decrypted = getApiKey('whisper_server_url');
    const configured = normalizeServerUrl(decrypted || localStorage.getItem('whisper_server_url'));

    // On hosted HTTPS pages, direct localhost calls can be blocked by browser PNA/CORS.
    // Prefer same-origin proxy path when user configured loopback URL.
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      const isLocalPage = host === 'localhost' || host === '127.0.0.1';
      const isHostedHttps = window.location.protocol === 'https:' && !isLocalPage;
      const isLoopbackTarget = configured.includes('localhost:3000') || configured.includes('127.0.0.1:3000');
      if (isHostedHttps && isLoopbackTarget) {
        return DEFAULT_SERVER_URL;
      }
    }

    return configured;
  };

  const getApiHeaders = (): Record<string, string> => {
    const key = getApiKey('whisper_api_key');
    const headers: Record<string, string> = key ? { 'X-API-Key': key } : {};
    // Tell server whether to free Ollama VRAM before transcribing
    try {
      const mode = localStorage.getItem('gpu_share_mode') === 'parallel' ? 'parallel' : 'serial';
      headers['X-GPU-Share-Mode'] = mode;
    } catch { /* ignore */ }
    return headers;
  };

  const setDisconnected = useCallback(() => {
    setIsConnected(false);
    setServerStatus(null);
    setModelReady(false);
    setModelLoading(false);
    window.dispatchEvent(new CustomEvent('server-connection-change', { detail: false }));
  }, []);

  const applyConnectedStatus = useCallback((data: ServerStatus) => {
    setServerStatus(data);
    setIsConnected(true);
    setModelReady(data.model_ready ?? false);
    setModelLoading(data.model_loading ?? false);
    window.dispatchEvent(new CustomEvent('server-connection-change', { detail: true }));
  }, []);

  const checkConnection = useCallback(async () => {
    const baseUrl = getBaseUrl();
    const url = `${baseUrl}/health`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        applyConnectedStatus(data as ServerStatus);
        return true;
      }
    } catch {
      // Server not running — silent
    }

    // Hosted app fallback: ask the local launcher (8764) about whisper status.
    // This keeps status/live-mode working even when direct localhost checks are flaky.
    const shouldTryLauncherHealth = (() => {
      if (typeof window === 'undefined') return false;
      const host = window.location.hostname;
      const isLocalPage = host === 'localhost' || host === '127.0.0.1';
      if (isLocalPage) return false;
      return baseUrl.includes('localhost:3000') || baseUrl.includes('127.0.0.1:3000');
    })();

    if (shouldTryLauncherHealth) {
      try {
        const launcherRes = await fetch('http://localhost:8764/health', {
          signal: AbortSignal.timeout(15000),
          headers: { 'Accept': 'application/json' },
        });
        if (launcherRes.ok) {
          const launcher = await launcherRes.json() as {
            whisper?: { running?: boolean };
          };
          if (launcher.whisper?.running) {
            const fallbackStatus: ServerStatus = {
              status: 'ok',
              device: 'cuda',
              gpu: null,
              current_model: null,
              cached_models: [],
              downloaded_models: [],
              available_models: [],
              model_loading: false,
              model_loading_id: null,
              model_ready: true,
            };
            applyConnectedStatus(fallbackStatus);
            return true;
          }
        }
      } catch {
        // Launcher not available — keep disconnected
      }
    }

    setDisconnected();
    return false;
  }, [applyConnectedStatus, setDisconnected]);

  /** Start polling — call this when the CUDA engine is selected.
   *  @param intervalMs  base polling interval (default 10 000 ms)
   *  @param maxDurationMs  if > 0, auto-stop polling after this many ms (0 = unlimited) */
  const startPolling = useCallback((intervalMs = 10000, maxDurationMs = 0) => {
    if (pollRef.current) clearInterval(pollRef.current);
    checkConnection();
    let currentInterval = intervalMs;
    const maxInterval = 60000;
    let consecutiveFails = 0;
    const startedAt = Date.now();

    const poll = async () => {
      // Auto-stop if maxDuration exceeded
      if (maxDurationMs > 0 && Date.now() - startedAt >= maxDurationMs) {
        debugLog.warn('Polling', `Max polling duration reached (${maxDurationMs / 1000}s) — stopping`);
        if (pollRef.current) { clearTimeout(pollRef.current as unknown as number); pollRef.current = undefined; }
        if ((pollRef as any)._visCleanup) { (pollRef as any)._visCleanup(); (pollRef as any)._visCleanup = undefined; }
        return;
      }
      const ok = await checkConnection();
      if (ok) {
        consecutiveFails = 0;
        currentInterval = intervalMs;
      } else {
        consecutiveFails++;
        currentInterval = Math.min(intervalMs * Math.pow(2, consecutiveFails), maxInterval);
      }
      pollRef.current = setTimeout(poll, currentInterval) as unknown as ReturnType<typeof setInterval>;
    };

    // Pause polling when tab is hidden, resume when visible
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (pollRef.current) { clearTimeout(pollRef.current as unknown as number); pollRef.current = undefined; }
      } else {
        checkConnection();
        poll();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    pollRef.current = setTimeout(poll, currentInterval) as unknown as ReturnType<typeof setInterval>;

    // Store cleanup for visibility listener
    (pollRef as any)._visCleanup = () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [checkConnection]);

  /** Stop polling — call this when the CUDA engine is deselected */
  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current as unknown as number);
      pollRef.current = undefined;
    }
    if ((pollRef as any)._visCleanup) {
      (pollRef as any)._visCleanup();
      (pollRef as any)._visCleanup = undefined;
    }
  }, []);

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current as unknown as number);
      if ((pollRef as any)._visCleanup) (pollRef as any)._visCleanup();
    };
  }, []);

  // ─── Legacy single-shot transcribe (still available for fallback) ───
  const transcribe = async (
    file: File,
    model?: string,
    language: string = 'he'
  ): Promise<ServerTranscriptionResult> => {
    setIsLoading(true);
    setProgress(10);

    try {
      const form = new FormData();
      form.append('file', file, file.name);
      if (model) form.append('model', model);
      form.append('language', language);

      setProgress(30);

      const res = await fetch(`${getBaseUrl()}/transcribe`, {
        method: 'POST',
        headers: getApiHeaders(),
        body: form,
      });

      setProgress(90);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const data = await res.json();
      setProgress(100);

      return {
        text: data.text,
        wordTimings: data.wordTimings || [],
        duration: data.duration,
        language: data.language,
        model: data.model,
        processing_time: data.processing_time,
      };
    } finally {
      setIsLoading(false);
      setProgress(0);
    }
  };

  // ─── Stage audio: pre-upload to server while model loads in parallel ───
  const stageAudio = async (file: File): Promise<string | null> => {
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await fetch(`${getBaseUrl()}/stage-audio`, {
        method: 'POST',
        headers: getApiHeaders(),
        body: form,
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.stage_id || null;
    } catch {
      return null;
    }
  };

  // ─── Parallel: stage audio + preload model simultaneously, then transcribe ───
  const transcribeStreamParallel = async (
    file: File,
    model?: string,
    language: string = 'he',
    onPartial?: (partial: PartialTranscript) => void,
    resumeFrom?: { startFrom: number; existingText: string; existingWords: WordTiming[] },
    cudaOptions?: CudaOptions,
  ): Promise<ServerTranscriptionResult> => {
    return enqueueTranscription(async () => {
    setIsLoading(true);
    setPhase('loading-model');
    setProgress(0);
    setPartialTranscript(null);

    if (!resumeFrom) {
      localStorage.removeItem(PARTIAL_STORAGE_KEY);
    }

    const ct = cudaOptions?.computeType || localStorage.getItem('cuda_compute_type') || undefined;

    // 1. PARALLEL: stage audio + ensure model is loaded
    debugLog.info('CUDA', 'Starting parallel stage + preload...');
    const [stageId] = await Promise.all([
      stageAudio(file),
      // Only preload if model not ready (preloadModelStream is a no-op if already cached)
      !modelReady ? preloadModelStream(model, ct).catch(() => ({ ready: false })) : Promise.resolve({ ready: true }),
    ]);
    debugLog.info('CUDA', `Stage: ${stageId ? 'OK' : 'FAILED'}, model ready: ${modelReady}`);

    // 2. Build form — use stage_id if available, otherwise fall back to normal upload
    const form = new FormData();
    if (stageId) {
      form.append('stage_id', stageId);
    } else {
      form.append('file', file, file.name);
    }
    if (model) form.append('model', model);
    form.append('language', language);
    if (resumeFrom) {
      form.append('start_from', String(resumeFrom.startFrom));
    }
    if (cudaOptions?.preset) {
      form.append('preset', cudaOptions.preset);
    }
    if (cudaOptions?.fastMode) {
      form.append('fast_mode', '1');
    }
    if (cudaOptions?.computeType) {
      form.append('compute_type', cudaOptions.computeType);
    }
    if (cudaOptions?.beamSize) {
      form.append('beam_size', String(cudaOptions.beamSize));
    }
    if (cudaOptions?.noConditionOnPrevious) {
      form.append('no_condition_on_previous', '1');
    }
    if (cudaOptions?.vadAggressive) {
      form.append('vad_aggressive', '1');
    }
    if (cudaOptions?.hotwords) {
      form.append('hotwords', cudaOptions.hotwords);
    }
    if (cudaOptions?.paragraphThreshold && cudaOptions.paragraphThreshold > 0) {
      form.append('paragraph_threshold', String(cudaOptions.paragraphThreshold));
    }
    if (cudaOptions?.initialPrompt) {
      form.append('initial_prompt', cudaOptions.initialPrompt);
    }
    if (cudaOptions?.loshonKodesh) {
      form.append('loshon_kodesh', '1');
    }

    const prefixText = resumeFrom?.existingText ? [resumeFrom.existingText] : [];
    const prefixWords = resumeFrom?.existingWords ? [...resumeFrom.existingWords] : [];

    // 3. Stream transcription (model should already be loaded)
    try {
      abortRef.current = new AbortController();
      setPhase('transcribing');

      const res = await fetch(`${getBaseUrl()}/transcribe-stream`, {
        method: 'POST',
        headers: getApiHeaders(),
        body: form,
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        if (res.status === 503) {
          throw new Error('המודל עדיין לא מוכן — נסה שוב בעוד כמה שניות');
        }
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming not supported');

      const decoder = new TextDecoder();
      let buffer = '';
      const accText: string[] = [...prefixText];
      const accWords: WordTiming[] = [...prefixWords];
      let audioDuration = 0;
      let resolvedModel = model;
      let lastSegEnd = resumeFrom?.startFrom || 0;
      let finalResult: ServerTranscriptionResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let evt: any;
          try { evt = JSON.parse(raw); } catch { continue; }

          if (evt.type === 'loading') {
            setPhase('loading-model');
          } else if (evt.type === 'info') {
            audioDuration = evt.duration || 0;
            setAudioDurationSec(audioDuration);
            setAudioProcessedSec(0);
            if (evt.model) resolvedModel = evt.model;
            setPhase('transcribing');
          } else if (evt.type === 'segment') {
            setPhase('transcribing');
            if (evt.paragraphBreak) accText.push('\n\n');
            accText.push(evt.text);
            if (evt.words) accWords.push(...evt.words);
            if (evt.segEnd) {
              lastSegEnd = evt.segEnd;
              setAudioProcessedSec(evt.segEnd);
            }
            const realProgress = evt.progress ?? 0;
            setProgress(realProgress);
            const partial: PartialTranscript = {
              text: accText.join(' '),
              wordTimings: [...accWords],
              progress: realProgress,
              audioDuration,
              lastSegEnd,
            };
            setPartialTranscript(partial);
            onPartial?.(partial);
            savePartialDebounced(partial);
          } else if (evt.type === 'done') {
            setProgress(100);
            const fullText = resumeFrom?.existingText
              ? resumeFrom.existingText + ' ' + evt.text
              : evt.text;
            const fullTimings = resumeFrom?.existingWords
              ? [...resumeFrom.existingWords, ...(evt.wordTimings || [])]
              : (evt.wordTimings || []);
            finalResult = {
              text: fullText,
              wordTimings: fullTimings,
              duration: evt.duration,
              language: evt.language,
              model: evt.model,
              processing_time: evt.processing_time,
              stats: evt.rtf != null ? {
                rtf: evt.rtf,
                file_size: evt.file_size,
                compute_type: evt.compute_type,
                beam_size: evt.beam_size,
                fast_mode: evt.fast_mode,
                processing_time: evt.processing_time,
                duration: evt.duration,
              } : undefined,
            };
            localStorage.removeItem(PARTIAL_STORAGE_KEY);
          } else if (evt.type === 'error') {
            throw new Error(evt.error || 'Server transcription error');
          }
        }
      }

      if (finalResult) return finalResult;
      if (accText.length > 0) {
        return {
          text: accText.join(' '),
          wordTimings: accWords,
          duration: audioDuration,
          model: resolvedModel,
        };
      }
      throw new Error('Stream ended without results');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('CANCELLED');
      }
      throw err;
    } finally {
      setIsLoading(false);
      setPhase('idle');
      abortRef.current = null;
    }
    });
  };

  // ─── Streaming transcribe with real progress + incremental saves ───
  const transcribeStream = async (
    file: File,
    model?: string,
    language: string = 'he',
    onPartial?: (partial: PartialTranscript) => void,
    resumeFrom?: { startFrom: number; existingText: string; existingWords: WordTiming[] },
    cudaOptions?: CudaOptions,
  ): Promise<ServerTranscriptionResult> => {
    return enqueueTranscription(async () => {
    setIsLoading(true);
    setPhase('loading-model');
    setProgress(resumeFrom ? Math.round((resumeFrom.startFrom / 1) * 0) : 0);
    setPartialTranscript(null);

    // Only clear partial if not resuming
    if (!resumeFrom) {
      localStorage.removeItem(PARTIAL_STORAGE_KEY);
    }

    const form = new FormData();
    form.append('file', file, file.name);
    if (model) form.append('model', model);
    form.append('language', language);
    if (resumeFrom) {
      form.append('start_from', String(resumeFrom.startFrom));
    }
    if (cudaOptions?.preset) {
      form.append('preset', cudaOptions.preset);
    }
    if (cudaOptions?.fastMode) {
      form.append('fast_mode', '1');
    }
    if (cudaOptions?.computeType) {
      form.append('compute_type', cudaOptions.computeType);
    }
    if (cudaOptions?.beamSize) {
      form.append('beam_size', String(cudaOptions.beamSize));
    }
    if (cudaOptions?.noConditionOnPrevious) {
      form.append('no_condition_on_previous', '1');
    }
    if (cudaOptions?.vadAggressive) {
      form.append('vad_aggressive', '1');
    }
    if (cudaOptions?.hotwords) {
      form.append('hotwords', cudaOptions.hotwords);
    }
    if (cudaOptions?.paragraphThreshold && cudaOptions.paragraphThreshold > 0) {
      form.append('paragraph_threshold', String(cudaOptions.paragraphThreshold));
    }
    if (cudaOptions?.initialPrompt) {
      form.append('initial_prompt', cudaOptions.initialPrompt);
    }
    if (cudaOptions?.loshonKodesh) {
      form.append('loshon_kodesh', '1');
    }

    // Prepend existing text/words when resuming
    const prefixText = resumeFrom?.existingText ? [resumeFrom.existingText] : [];
    const prefixWords = resumeFrom?.existingWords ? [...resumeFrom.existingWords] : [];

    try {
      abortRef.current = new AbortController();
      const streamUrl = `${getBaseUrl()}/transcribe-stream`;

      const res = await fetch(streamUrl, {
        method: 'POST',
        headers: getApiHeaders(),
        body: form,
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Server error ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming not supported');


      const decoder = new TextDecoder();
      let buffer = '';
      const accText: string[] = [...prefixText];
      const accWords: WordTiming[] = [...prefixWords];
      let audioDuration = 0;
      let resolvedModel = model; // track model from SSE info event
      let lastSegEnd = resumeFrom?.startFrom || 0;
      let finalResult: ServerTranscriptionResult | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let evt: any;
          try { evt = JSON.parse(raw); } catch { continue; }

          debugLog.info('CUDA-SSE', `event: ${evt.type}`, evt.type === 'segment' ? `progress=${evt.progress}% words=${evt.words?.length}` : evt);

          if (evt.type === 'loading') {
            setPhase('loading-model');
          } else if (evt.type === 'info') {
            audioDuration = evt.duration || 0;
            setAudioDurationSec(audioDuration);
            setAudioProcessedSec(0);
            if (evt.model) resolvedModel = evt.model;
            setPhase('transcribing');
          } else if (evt.type === 'segment') {
            setPhase('transcribing'); // ensure phase transitions even if info event was missed
            if (evt.paragraphBreak) accText.push('\n\n');
            accText.push(evt.text);
            if (evt.words) accWords.push(...evt.words);
            if (evt.segEnd) {
              lastSegEnd = evt.segEnd;
              setAudioProcessedSec(evt.segEnd);
            }

            const realProgress = evt.progress ?? 0;
            setProgress(realProgress);

            const partial: PartialTranscript = {
              text: accText.join(' '),
              wordTimings: [...accWords],
              progress: realProgress,
              audioDuration,
              lastSegEnd,
            };
            setPartialTranscript(partial);
            onPartial?.(partial);

            // Persist partial to localStorage for crash recovery (debounced)
            savePartialDebounced(partial);
          } else if (evt.type === 'done') {

            setProgress(100);
            // When resuming, merge with prefix text
            const fullText = resumeFrom?.existingText
              ? resumeFrom.existingText + ' ' + evt.text
              : evt.text;
            const fullTimings = resumeFrom?.existingWords
              ? [...resumeFrom.existingWords, ...(evt.wordTimings || [])]
              : (evt.wordTimings || []);
            finalResult = {
              text: fullText,
              wordTimings: fullTimings,
              duration: evt.duration,
              language: evt.language,
              model: evt.model,
              processing_time: evt.processing_time,
              stats: evt.rtf != null ? {
                rtf: evt.rtf,
                file_size: evt.file_size,
                compute_type: evt.compute_type,
                beam_size: evt.beam_size,
                fast_mode: evt.fast_mode,
                processing_time: evt.processing_time,
                duration: evt.duration,
              } : undefined,
            };
            // Clear partial — we have the full result
            localStorage.removeItem(PARTIAL_STORAGE_KEY);
          } else if (evt.type === 'error') {
            throw new Error(evt.error || 'Server transcription error');
          }
        }
      }

      if (finalResult) return finalResult;

      // If stream ended without 'done' event, use accumulated data
      if (accText.length > 0) {
        return {
          text: accText.join(' '),
          wordTimings: accWords,
          duration: audioDuration,
          model: resolvedModel,
        };
      }

      debugLog.warn('CUDA', 'Stream ended without results (no accText)');
      throw new Error('Stream ended without results');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {

        throw new Error('CANCELLED');
      }
      debugLog.error('CUDA', 'transcribeStream error', err instanceof Error ? err.message : String(err));
      throw err;
    } finally {

      setIsLoading(false);
      setPhase('idle');
      abortRef.current = null;
    }
    });
  };

  /**
   * Recover a partial transcript from a previous interrupted session.
   * Returns null if nothing was saved.
   */
  const recoverPartial = useCallback((): PartialTranscript | null => {
    try {
      const raw = localStorage.getItem(PARTIAL_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as PartialTranscript;
    } catch {
      return null;
    }
  }, []);

  const clearPartial = () => {
    localStorage.removeItem(PARTIAL_STORAGE_KEY);
    setPartialTranscript(null);
  };

  const cancelStream = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setIsLoading(false);
    setProgress(0);
    setAudioDurationSec(0);
    setAudioProcessedSec(0);
  };

  const loadModel = async (modelId: string) => {
    const res = await fetch(`${getBaseUrl()}/load-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getApiHeaders() },
      body: JSON.stringify({ model: modelId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }));
      throw new Error(err.error);
    }
    await checkConnection(); // Refresh status
  };

  const downloadModel = async (modelId: string) => {
    const res = await fetch(`${getBaseUrl()}/download-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getApiHeaders() },
      body: JSON.stringify({ model: modelId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed' }));
      throw new Error(err.error);
    }
    await checkConnection(); // Refresh status
  };

  const shutdownServer = useCallback(async () => {
    try {
      await fetch(`${getBaseUrl()}/shutdown`, { method: 'POST', headers: getApiHeaders(), signal: AbortSignal.timeout(3000) });
    } catch {
      // Expected — server dies before responding
    }
    setIsConnected(false);
    setServerStatus(null);
  }, []);

  const warmupServer = useCallback(async () => {
    try {
      const res = await fetch(`${getBaseUrl()}/warmup`, { method: 'POST', headers: getApiHeaders(), signal: AbortSignal.timeout(30000) });
      if (res.ok) {
        const data = await res.json();
        return data.warmup_time as number;
      }
    } catch {
      // Server not available
    }
    return null;
  }, []);

  /** Preload model via SSE — returns a promise that resolves when the model is ready */
  const preloadModelStream = useCallback(async (
    modelId?: string,
    computeType?: string,
    onProgress?: (message: string) => void,
  ): Promise<{ ready: boolean; elapsed?: number }> => {
    const model = modelId || localStorage.getItem('preferred_local_model') || undefined;
    const ct = computeType || localStorage.getItem('cuda_compute_type') || undefined;

    setModelLoading(true);
    preloadAbortRef.current = new AbortController();

    try {
      const res = await fetch(`${getBaseUrl()}/preload-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getApiHeaders() },
        body: JSON.stringify({ model, compute_type: ct }),
        signal: preloadAbortRef.current.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Streaming not supported');

      const decoder = new TextDecoder();
      let buffer = '';
      let result: { ready: boolean; elapsed?: number } = { ready: false };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          let evt: any;
          try { evt = JSON.parse(raw); } catch { continue; }

          if (evt.type === 'progress') {
            onProgress?.(evt.message || 'Loading...');
          } else if (evt.type === 'status') {
            if (evt.status === 'ready') {
              setModelReady(true);
              setModelLoading(false);
              result = { ready: true, elapsed: evt.elapsed };
              onProgress?.(evt.message || 'Model ready');
            } else if (evt.status === 'loading') {
              onProgress?.(evt.message || 'Loading...');
            } else if (evt.status === 'error') {
              setModelLoading(false);
              result = { ready: false };
              onProgress?.(evt.message || 'Error');
            }
          }
        }
      }

      return result;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { ready: false };
      }
      throw err;
    } finally {
      setModelLoading(false);
      preloadAbortRef.current = null;
      await checkConnection(); // Refresh status
    }
  }, [checkConnection]);

  const cancelPreload = useCallback(() => {
    if (preloadAbortRef.current) {
      preloadAbortRef.current.abort();
    }
  }, []);

  return {
    isConnected,
    serverStatus,
    isLoading,
    progress,
    phase,
    partialTranscript,
    audioDurationSec,
    audioProcessedSec,
    modelReady,
    modelLoading,
    transcribe,
    transcribeStream,
    transcribeStreamParallel,
    stageAudio,
    cancelStream,
    recoverPartial,
    clearPartial,
    loadModel,
    downloadModel,
    preloadModelStream,
    cancelPreload,
    checkConnection,
    startPolling,
    stopPolling,
    shutdownServer,
    warmupServer,
    getBaseUrl,
  };
};
