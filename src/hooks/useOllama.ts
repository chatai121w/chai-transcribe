import { useState, useEffect, useCallback, useRef } from "react";
import { ACTION_PROMPTS, TONE_PROMPTS } from "@/lib/prompts";
import { getGpuShareMode, waitUntilWhisperIdle } from "@/lib/gpuShareMode";
import { buildHebrewGuardPrefix, isHebrewOnlyEnabled, containsForeignScript } from "@/lib/hebrewGuard";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

export interface OllamaPullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface OllamaPullJob {
  modelName: string;
  status: 'idle' | 'starting' | 'pulling' | 'retrying' | 'completed' | 'error' | 'cancelled';
  progress: OllamaPullProgress | null;
  percent: number;
  retries: number;
  error?: string;
  updatedAt: number;
  // Speed & ETA fields
  speedBps: number;       // bytes per second
  etaSeconds: number;     // estimated seconds remaining
  startedAt: number;      // when this pull started
  downloadedBytes: number;
  totalBytes: number;
}

const OLLAMA_URL_KEY = 'ollama_base_url';
const OLLAMA_PULL_JOBS_KEY = 'ollama_pull_jobs_v1';

export function getOllamaUrl(): string {
  return localStorage.getItem(OLLAMA_URL_KEY) || DEFAULT_OLLAMA_URL;
}

export function setOllamaUrl(url: string) {
  localStorage.setItem(OLLAMA_URL_KEY, url);
}

export function useOllama() {
  const [isConnected, setIsConnected] = useState(false);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [pullJobs, setPullJobs] = useState<Record<string, OllamaPullJob>>(() => {
    try {
      const raw = localStorage.getItem(OLLAMA_PULL_JOBS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object') return {};
      const entries = Object.entries(parsed as Record<string, OllamaPullJob>).map(([name, job]) => {
        // Any persisted in-flight state becomes resumable
        const normalizedStatus = ['starting', 'pulling', 'retrying'].includes(job.status)
          ? 'cancelled'
          : job.status;
        return [name, {
          ...job,
          status: normalizedStatus,
          updatedAt: Date.now(),
        } satisfies OllamaPullJob];
      });
      return Object.fromEntries(entries);
    } catch {
      return {};
    }
  });
  const abortRef = useRef<AbortController | null>(null);
  const pullControllersRef = useRef<Map<string, AbortController>>(new Map());

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    setConnectionError(null);
    try {
      const baseUrl = getOllamaUrl();
      const fallbackUrls = baseUrl.includes('localhost')
        ? [baseUrl, baseUrl.replace('localhost', '127.0.0.1')]
        : [baseUrl];

      for (const url of fallbackUrls) {
        try {
          const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          setModels(data.models || []);
          setIsConnected(true);
          setConnectionError(null);
          if (url !== baseUrl) setOllamaUrl(url);
          return true;
        } catch {
          // Try next URL
        }
      }

      throw new Error('CONNECTION_FAILED');
    } catch (err) {
      setIsConnected(false);
      setModels([]);
      if (err instanceof Error && err.name === 'TimeoutError') {
        setConnectionError('נגמר זמן ההמתנה לחיבור (Timeout). בדוק ש-ollama serve רץ.');
      } else {
        setConnectionError('לא ניתן להתחבר ל-Ollama. ודא שהשירות רץ וש-CORS מוגדר (OLLAMA_ORIGINS=*).');
      }
      return false;
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OLLAMA_PULL_JOBS_KEY, JSON.stringify(pullJobs));
    } catch {
      // Ignore storage failures (private mode/quota)
    }
  }, [pullJobs]);

  const upsertPullJob = useCallback((modelName: string, patch: Partial<OllamaPullJob>) => {
    setPullJobs(prev => {
      const existing: OllamaPullJob = prev[modelName] || {
        modelName,
        status: 'idle',
        progress: null,
        percent: 0,
        retries: 0,
        updatedAt: Date.now(),
        speedBps: 0,
        etaSeconds: 0,
        startedAt: 0,
        downloadedBytes: 0,
        totalBytes: 0,
      };
      return {
        ...prev,
        [modelName]: {
          ...existing,
          ...patch,
          updatedAt: Date.now(),
        },
      };
    });
  }, []);

  // Smart polling: fast when connected, exponential backoff when disconnected,
  // pauses when tab is hidden
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const BASE_INTERVAL = 30_000;
    const MAX_INTERVAL = 120_000;
    let currentInterval = BASE_INTERVAL;

    const poll = async () => {
      const ok = await checkConnection();
      currentInterval = ok
        ? BASE_INTERVAL
        : Math.min(currentInterval * 2, MAX_INTERVAL);
      timeoutId = setTimeout(poll, currentInterval);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timeoutId);
      } else {
        // Immediate check on tab focus, then resume schedule
        currentInterval = BASE_INTERVAL;
        poll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    // Initial check
    poll();

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [checkConnection]);

  const pullModel = useCallback(async (modelName: string, onProgress?: (p: OllamaPullProgress) => void) => {
    const normalizedName = modelName.trim();
    if (!normalizedName) throw new Error('Model name is required');

    if (pullControllersRef.current.has(normalizedName)) {
      return;
    }

    const MAX_RETRIES = 3;
    const STALL_MS = 45_000;

    const runAttempt = async (attempt: number): Promise<void> => {
      const baseUrl = getOllamaUrl();
      const controller = new AbortController();
      abortRef.current = controller;
      pullControllersRef.current.set(normalizedName, controller);

      upsertPullJob(normalizedName, {
        status: attempt === 0 ? 'starting' : 'retrying',
        retries: attempt,
        error: undefined,
        startedAt: Date.now(),
        speedBps: 0,
        etaSeconds: 0,
      });

      try {
        const res = await fetch(`${baseUrl}/api/pull`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: normalizedName }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Pull failed: ${res.statusText}`);
        if (!res.body) throw new Error('No response body');

        let lastActivity = Date.now();
        let layerStartTime = Date.now();
        let layerStartBytes = 0;
        let lastDigest = '';
        const stallTimer = setInterval(() => {
          if (Date.now() - lastActivity > STALL_MS) {
            controller.abort('stalled');
          }
        }, 10_000);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let pending = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            lastActivity = Date.now();

            pending += decoder.decode(value, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const progress = JSON.parse(line) as OllamaPullProgress;
                setPullJobs(prev => {
                  const existing = prev[normalizedName];
                  const completed = progress.completed || 0;
                  const total = progress.total || 0;
                  const computedPercent = total > 0
                    ? Math.round((completed / total) * 100)
                    : existing?.percent || 0;

                  // Track per-layer speed: reset when digest changes
                  const now = Date.now();
                  if (progress.digest && progress.digest !== lastDigest) {
                    lastDigest = progress.digest;
                    layerStartTime = now;
                    layerStartBytes = 0;
                  }

                  const elapsedSec = Math.max((now - layerStartTime) / 1000, 0.5);
                  const downloadedSinceStart = completed - layerStartBytes;
                  const speedBps = downloadedSinceStart > 0 ? downloadedSinceStart / elapsedSec : 0;
                  const remaining = total - completed;
                  const etaSeconds = speedBps > 0 ? remaining / speedBps : 0;

                  const nextJob: OllamaPullJob = {
                    modelName: normalizedName,
                    status: 'pulling',
                    progress,
                    percent: computedPercent,
                    retries: attempt,
                    error: undefined,
                    updatedAt: now,
                    speedBps,
                    etaSeconds,
                    startedAt: existing?.startedAt || layerStartTime,
                    downloadedBytes: completed,
                    totalBytes: total,
                  };

                  return {
                    ...prev,
                    [normalizedName]: nextJob,
                  };
                });
                onProgress?.(progress);
              } catch {
                // Ignore malformed stream lines
              }
            }
          }
        } finally {
          clearInterval(stallTimer);
        }

        upsertPullJob(normalizedName, {
          status: 'completed',
          percent: 100,
          progress: { status: 'success' },
          error: undefined,
        });

        await checkConnection();
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        if (isAbort && attempt < MAX_RETRIES) {
          pullControllersRef.current.delete(normalizedName);
          upsertPullJob(normalizedName, {
            status: 'retrying',
            retries: attempt + 1,
            error: 'חיבור נתקע, מנסה להמשיך מאותה נקודה...',
          });
          await new Promise(r => setTimeout(r, 1200));
          return runAttempt(attempt + 1);
        }

        upsertPullJob(normalizedName, {
          status: isAbort ? 'cancelled' : 'error',
          error: err instanceof Error ? err.message : 'שגיאת הורדה',
        });
        throw err;
      } finally {
        pullControllersRef.current.delete(normalizedName);
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    };

    return runAttempt(0);
  }, [checkConnection, upsertPullJob]);

  const cancelPull = useCallback((modelName?: string) => {
    if (modelName) {
      const c = pullControllersRef.current.get(modelName);
      c?.abort();
      upsertPullJob(modelName, {
        status: 'cancelled',
        error: 'בוטל על ידי המשתמש',
      });
      return;
    }

    // Backward-compatible global cancel
    pullControllersRef.current.forEach((controller, name) => {
      controller.abort();
      upsertPullJob(name, {
        status: 'cancelled',
        error: 'בוטל על ידי המשתמש',
      });
    });
    abortRef.current?.abort();
  }, []);

  const deleteModel = useCallback(async (modelName: string) => {
    const baseUrl = getOllamaUrl();
    const res = await fetch(`${baseUrl}/api/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
    });
    if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
    await checkConnection();
  }, [checkConnection]);

  const resumePull = useCallback(async (modelName: string) => {
    return pullModel(modelName);
  }, [pullModel]);

  const isPulling = Object.values(pullJobs).some(job =>
    job.status === 'starting' || job.status === 'pulling' || job.status === 'retrying'
  );
  const latestActiveJob = [...Object.values(pullJobs)]
    .filter(job => job.status === 'starting' || job.status === 'pulling' || job.status === 'retrying')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const pullProgress = latestActiveJob?.progress || null;

  const editText = useCallback(async (params: {
    text: string;
    action: string;
    model: string;
    customPrompt?: string;
    toneStyle?: string;
    targetLanguage?: string;
  }): Promise<string> => {
    const { text, action, model, customPrompt, toneStyle, targetLanguage } = params;
    const baseUrl = getOllamaUrl();

    // ── GPU sharing: in 'serial' mode, wait for Whisper to finish first ──
    if (getGpuShareMode() === 'serial') {
      await waitUntilWhisperIdle(5 * 60 * 1000, 1500);
    }

    let systemPrompt = '';
    if (action === 'custom' && customPrompt) {
      systemPrompt = customPrompt;
    } else if (action === 'tone') {
      systemPrompt = TONE_PROMPTS[toneStyle || 'formal'] || TONE_PROMPTS.formal;
    } else if (action === 'translate') {
      const lang = targetLanguage || 'אנגלית';
      if (lang === 'עברית') {
        systemPrompt = 'You are a professional translator. Translate the following text into Hebrew (עברית). Preserve the original meaning and style. Do not add notes — only the translation itself.';
      } else {
        systemPrompt = `אתה מתרגם מקצועי. תרגם את הטקסט הבא ל${lang}. שמור על המשמעות והסגנון המקורי. אל תוסיף הערות — רק את התרגום עצמו.`;
      }
    } else {
      systemPrompt = ACTION_PROMPTS[action];
      if (!systemPrompt) throw new Error(`Invalid action: ${action}`);
    }

    // ── Hebrew-only output guard (skipped for action='translate') ──
    const hebrewPrefix = buildHebrewGuardPrefix(action);
    if (hebrewPrefix) systemPrompt = hebrewPrefix + '\n' + systemPrompt;

    /** Run a single chat request. Returns the model output. */
    const runOnce = async (sysPrompt: string, temperature: number): Promise<string> => {
      // OpenAI-compatible endpoint first (newer Ollama versions)
      const r1 = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: text },
          ],
          stream: false,
          temperature,
        }),
      });
      if (r1.ok) {
        const d1 = await r1.json();
        const c1 = d1.choices?.[0]?.message?.content;
        if (c1) return c1;
      }
      // Fallback to /api/chat for older Ollama versions
      const r2 = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: text },
          ],
          stream: false,
          options: { temperature, repeat_penalty: 1.15 },
        }),
      });
      if (!r2.ok) {
        const err = await r2.text().catch(() => r2.statusText);
        throw new Error(`Ollama error: ${err}`);
      }
      const d2 = await r2.json();
      const c2 = d2?.message?.content;
      if (!c2) throw new Error('No response from Ollama model');
      return c2;
    };

    // Lower temperature when Hebrew guard is on — reduces drift to other languages.
    const guardOn = isHebrewOnlyEnabled() && action !== 'translate';
    const initialTemp = guardOn ? 0.2 : 0.7;
    let result = await runOnce(systemPrompt, initialTemp);

    // Auto-retry once if the result contains foreign script while guard is on.
    if (guardOn) {
      const check = containsForeignScript(result);
      if (check.found) {
        const retryPrefix = [
          '⚠️ הניסיון הקודם נכשל — הוסיף תווים בשפה זרה!',
          `נמצאו תווים אסורים: ${check.samples.slice(0, 5).join(' ')}`,
          'נסה שוב — הפעם רק עברית, ללא יוצאים מן הכלל.',
          '',
        ].join('\n');
        result = await runOnce(retryPrefix + systemPrompt, 0.1);
      }
    }
    return result;
  }, []);

  /**
   * Warm up a model — load it into VRAM in the background so the first
   * real request is fast. Uses an empty prompt with keep_alive=10m.
   * Safe to call multiple times; Ollama is idempotent.
   */
  const warmupModel = useCallback(async (modelName: string): Promise<boolean> => {
    if (!modelName) return false;
    try {
      const baseUrl = getOllamaUrl();
      const res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName, prompt: '', keep_alive: '10m' }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  return {
    isConnected,
    isChecking,
    connectionError,
    models,
    isPulling,
    pullProgress,
    pullJobs,
    checkConnection,
    pullModel,
    cancelPull,
    resumePull,
    deleteModel,
    editText,
    warmupModel,
  };
}

// Helper to check if a model value is an Ollama model
export const isOllamaModel = (value: string) => value.startsWith('ollama:');

// Extract the actual model name from the prefixed value
export const getOllamaModelName = (value: string) => value.replace('ollama:', '');

// Format model size in human-readable form
export const formatModelSize = (bytes: number): string => {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
};
