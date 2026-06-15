/**
 * Persistent background AI edit job queue — survives navigation & page refresh.
 *
 * Jobs are stored in IndexedDB. A global singleton processor runs them
 * one-at-a-time (or per-engine in parallel). Partial results (per round)
 * are saved after every round so nothing is lost on interruption.
 *
 * Usage:
 *   aiEditQueue.enqueue(job)        — add a job
 *   aiEditQueue.subscribe(cb)       — listen for state changes
 *   aiEditQueue.cancel(id)          — cancel a running/pending job
 *   aiEditQueue.resume(id)          — re-queue a stopped/failed job
 *   aiEditQueue.getAll()            — snapshot of all jobs
 */

import { editTranscriptCloud } from '@/utils/editTranscriptApi';
import { debugLog } from '@/lib/debugLogger';

// ─── Types ───────────────────────────────────────────────────

export type EditAction = 'improve' | 'grammar' | 'readable' | 'punctuation' | 'paragraphs' |
  'bullets' | 'headings' | 'expand' | 'shorten' | 'summarize' |
  'sources' | 'translate' | 'speakers' | 'tone' | 'custom';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RoundResult {
  text: string;
  latencyMs: number;
  qualityScore: number;
}

export interface AIEditJob {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;

  // Input
  sourceText: string;
  action: EditAction;
  model1: string;
  model2: string;
  model1Label: string;
  model2Label: string;
  totalRounds: number;
  extra?: { customPrompt?: string; toneStyle?: string; targetLanguage?: string };

  // Progress
  completedRounds: number;
  m1Results: RoundResult[];
  m2Results: RoundResult[];

  // Final summary (set when completed)
  summary?: BenchmarkSummaryPersist;

  // Error info
  error?: string;
}

export interface BenchmarkSummaryPersist {
  action: EditAction;
  rounds: number;
  createdAt: string;
  model1Value: string;
  model2Value: string;
  model1Label: string;
  model2Label: string;
  model1: {
    avgLatency: number; stdLatency: number;
    avgQuality: number; stdQuality: number;
    bestQuality: number; bestText: string;
  };
  model2: {
    avgLatency: number; stdLatency: number;
    avgQuality: number; stdQuality: number;
    bestQuality: number; bestText: string;
  };
  winner: 1 | 2;
}

type Listener = () => void;

// Resolve model API name — mirrors AIEditorDual logic
function getModelApi(modelValue: string): string {
  // Known cloud model mappings (subset — cloud models pass through to editTranscriptCloud)
  const MAP: Record<string, string> = {
    'gemini-flash': 'google/gemini-2.5-flash',
    'gemini-pro': 'google/gemini-2.5-pro',
    'gemini-flash-lite': 'google/gemini-2.5-flash-lite',
    'gemini-3-flash': 'google/gemini-3-flash-preview',
    'gemini-3.1-pro': 'google/gemini-3.1-pro-preview',
    'gpt-5': 'openai/gpt-5',
    'gpt-5-mini': 'openai/gpt-5-mini',
    'gpt-5-nano': 'openai/gpt-5-nano',
    'gpt-5.2': 'openai/gpt-5.2',
    'gpt-4o': 'openai/gpt-4o',
    'gpt-4o-mini': 'openai/gpt-4o-mini',
    'claude-4-sonnet': 'anthropic/claude-sonnet-4',
    'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet',
    'claude-3.5-haiku': 'anthropic/claude-3.5-haiku',
    'deepseek-v3': 'deepseek/deepseek-chat',
    'deepseek-r1': 'deepseek/deepseek-reasoner',
    'qwen-plus': 'qwen/qwen-plus',
    'qwen-max': 'qwen/qwen-max',
  };
  return MAP[modelValue] || modelValue;
}

// ─── Scoring (mirrors AIEditorDual.scoreText) ────────────────

function scoreText(source: string, output: string, latencyMs: number): number {
  const src = source.trim();
  const out = output.trim();
  const srcWords = src.split(/\s+/).filter(Boolean);
  const outWords = out.split(/\s+/).filter(Boolean);

  const srcSet = new Set(srcWords.map(w => w.replace(/[^\u0590-\u05FFA-Za-z0-9]/g, '').toLowerCase()).filter(Boolean));
  const outSet = new Set(outWords.map(w => w.replace(/[^\u0590-\u05FFA-Za-z0-9]/g, '').toLowerCase()).filter(Boolean));
  let overlap = 0;
  srcSet.forEach(w => { if (outSet.has(w)) overlap++; });
  const preserveScore = srcSet.size > 0 ? overlap / srcSet.size : 0;

  const hebChars = (out.match(/[\u0590-\u05FF]/g) || []).length;
  const alphaChars = (out.match(/[A-Za-z\u0590-\u05FF]/g) || []).length;
  const hebrewRatio = alphaChars > 0 ? hebChars / alphaChars : 0;

  const punct = (out.match(/[.,!?;:\-—…״"'']/g) || []).length;
  const punctuationDensity = outWords.length > 0 ? punct / outWords.length : 0;

  const srcLen = Math.max(1, src.length);
  const lengthDrift = Math.min(1, Math.abs(out.length - src.length) / srcLen);

  const speedScore = Math.max(0, 1 - (latencyMs / 12000));
  return (
    preserveScore * 0.4 +
    Math.min(1, hebrewRatio) * 0.2 +
    Math.min(1, punctuationDensity * 8) * 0.15 +
    (1 - lengthDrift) * 0.15 +
    speedScore * 0.1
  ) * 100;
}

function avg(arr: number[]): number {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length <= 1) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map(v => (v - m) ** 2)));
}

// ─── IndexedDB helpers ───────────────────────────────────────

const DB_NAME = 'ai_edit_queue';
const DB_VERSION = 1;
const STORE = 'jobs';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(job: AIEditJob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(job);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function dbGetAll(): Promise<AIEditJob[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result as AIEditJob[]); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function dbDelete(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ─── Queue singleton ─────────────────────────────────────────

class AIEditQueueManager {
  private jobs: AIEditJob[] = [];
  private listeners: Set<Listener> = new Set();
  private processing = false;
  private cancelledIds: Set<string> = new Set();
  private initialized = false;

  /** Load persisted jobs from IndexedDB on startup */
  async init() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const stored = await dbGetAll();
      // Reset any 'running' jobs to 'pending' (interrupted by refresh)
      this.jobs = stored.map(j =>
        j.status === 'running' ? { ...j, status: 'pending' as const, updatedAt: Date.now() } : j
      );
      // Persist the status change
      for (const j of this.jobs) {
        if (j.status === 'pending') await dbPut(j);
      }
      this.notify();
      // Auto-process any pending jobs
      this.processNext();
    } catch (err) {
      debugLog.error('AIEditQueue', 'Failed to load from IndexedDB', err);
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  getAll(): AIEditJob[] {
    return [...this.jobs].sort((a, b) => b.createdAt - a.createdAt);
  }

  getJob(id: string): AIEditJob | undefined {
    return this.jobs.find(j => j.id === id);
  }

  /** Enqueue a new benchmark/edit job */
  async enqueue(params: {
    sourceText: string;
    action: EditAction;
    model1: string;
    model2: string;
    model1Label: string;
    model2Label: string;
    totalRounds: number;
    extra?: { customPrompt?: string; toneStyle?: string; targetLanguage?: string };
  }): Promise<string> {
    const id = `aiedit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job: AIEditJob = {
      id,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      sourceText: params.sourceText,
      action: params.action,
      model1: params.model1,
      model2: params.model2,
      model1Label: params.model1Label,
      model2Label: params.model2Label,
      totalRounds: params.totalRounds,
      extra: params.extra,
      completedRounds: 0,
      m1Results: [],
      m2Results: [],
    };
    this.jobs.push(job);
    await dbPut(job);
    this.notify();
    debugLog.info('AIEditQueue', `Enqueued job ${id}: ${params.action} (${params.totalRounds} rounds)`);
    this.processNext();
    return id;
  }

  /** Cancel a pending or running job */
  async cancel(id: string) {
    const job = this.jobs.find(j => j.id === id);
    if (!job) return;
    this.cancelledIds.add(id);
    if (job.status === 'pending') {
      job.status = 'cancelled';
      job.updatedAt = Date.now();
      await dbPut(job);
      this.notify();
    }
    // If running, the loop will check cancelledIds and stop
  }

  /** Resume a failed/cancelled job from where it stopped */
  async resume(id: string) {
    const job = this.jobs.find(j => j.id === id);
    if (!job || (job.status !== 'failed' && job.status !== 'cancelled')) return;
    this.cancelledIds.delete(id);
    job.status = 'pending';
    job.error = undefined;
    job.updatedAt = Date.now();
    await dbPut(job);
    this.notify();
    debugLog.info('AIEditQueue', `Resumed job ${id} from round ${job.completedRounds}/${job.totalRounds}`);
    this.processNext();
  }

  /** Remove a job completely */
  async remove(id: string) {
    this.cancelledIds.add(id);
    this.jobs = this.jobs.filter(j => j.id !== id);
    await dbDelete(id);
    this.notify();
  }

  /** Clear all completed/failed/cancelled jobs */
  async clearFinished() {
    const toRemove = this.jobs.filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled');
    for (const j of toRemove) {
      await dbDelete(j.id);
    }
    this.jobs = this.jobs.filter(j => j.status === 'pending' || j.status === 'running');
    this.notify();
  }

  // ─── Processing loop ────────────────────────────────────────

  private async processNext() {
    if (this.processing) return;

    const next = this.jobs.find(j => j.status === 'pending');
    if (!next) return;

    this.processing = true;
    next.status = 'running';
    next.updatedAt = Date.now();
    await dbPut(next);
    this.notify();

    try {
      await this.runJob(next);
    } catch (err) {
      if (next.status === 'running') {
        next.status = 'failed';
        next.error = err instanceof Error ? err.message : String(err);
        next.updatedAt = Date.now();
        await dbPut(next);
        debugLog.error('AIEditQueue', `Job ${next.id} failed`, next.error);
      }
    } finally {
      this.processing = false;
      this.notify();
      // Process next in queue
      this.processNext();
    }
  }

  private async runJob(job: AIEditJob) {
    const startRound = job.completedRounds;

    for (let i = startRound; i < job.totalRounds; i++) {
      // Check cancellation
      if (this.cancelledIds.has(job.id)) {
        job.status = 'cancelled';
        job.updatedAt = Date.now();
        await dbPut(job);
        this.cancelledIds.delete(job.id);
        debugLog.info('AIEditQueue', `Job ${job.id} cancelled at round ${i}/${job.totalRounds}`);
        return;
      }

      // Run both engines in parallel for this round
      const [r1, r2] = await Promise.all([
        this.runSingleEngine(job.sourceText, job.action, job.model1, job.extra),
        this.runSingleEngine(job.sourceText, job.action, job.model2, job.extra),
      ]);

      const s1 = scoreText(job.sourceText, r1.text, r1.latencyMs);
      const s2 = scoreText(job.sourceText, r2.text, r2.latencyMs);

      job.m1Results.push({ text: r1.text, latencyMs: r1.latencyMs, qualityScore: s1 });
      job.m2Results.push({ text: r2.text, latencyMs: r2.latencyMs, qualityScore: s2 });
      job.completedRounds = i + 1;
      job.updatedAt = Date.now();

      // Save progress after every round
      await dbPut(job);
      this.notify();
      debugLog.info('AIEditQueue', `Job ${job.id}: round ${i + 1}/${job.totalRounds} done`);
    }

    // All rounds completed — compute summary
    job.summary = this.buildSummary(job);
    job.status = 'completed';
    job.updatedAt = Date.now();
    await dbPut(job);

    // Browser notification if tab is hidden
    if (document.visibilityState === 'hidden' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Benchmark הושלם ✅', {
        body: `${job.model1Label} vs ${job.model2Label} — ${job.totalRounds} סבבים`,
        icon: '/favicon.ico',
      });
    }

    debugLog.info('AIEditQueue', `Job ${job.id} completed!`);
  }

  private async runSingleEngine(
    text: string,
    action: EditAction,
    modelValue: string,
    extra?: { customPrompt?: string; toneStyle?: string; targetLanguage?: string },
  ): Promise<{ text: string; latencyMs: number }> {
    const startedAt = performance.now();

    // For now, only cloud models are supported in background queue.
    // Ollama models require the useOllama hook which is component-bound.
    const resultText = await editTranscriptCloud({
      text,
      action,
      model: getModelApi(modelValue),
      customPrompt: extra?.customPrompt,
      toneStyle: extra?.toneStyle,
      targetLanguage: extra?.targetLanguage,
    });

    return {
      text: resultText,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }

  private buildSummary(job: AIEditJob): BenchmarkSummaryPersist {
    const m1Latencies = job.m1Results.map(r => r.latencyMs);
    const m2Latencies = job.m2Results.map(r => r.latencyMs);
    const m1Scores = job.m1Results.map(r => r.qualityScore);
    const m2Scores = job.m2Results.map(r => r.qualityScore);

    const m1AvgQ = avg(m1Scores);
    const m2AvgQ = avg(m2Scores);
    const m1AvgL = avg(m1Latencies);
    const m2AvgL = avg(m2Latencies);

    const best1 = job.m1Results.reduce((a, b) => a.qualityScore > b.qualityScore ? a : b, job.m1Results[0]);
    const best2 = job.m2Results.reduce((a, b) => a.qualityScore > b.qualityScore ? a : b, job.m2Results[0]);

    const winner: 1 | 2 = m1AvgQ === m2AvgQ
      ? (m1AvgL <= m2AvgL ? 1 : 2)
      : (m1AvgQ > m2AvgQ ? 1 : 2);

    return {
      action: job.action,
      rounds: job.totalRounds,
      createdAt: new Date(job.createdAt).toISOString(),
      model1Value: job.model1,
      model2Value: job.model2,
      model1Label: job.model1Label,
      model2Label: job.model2Label,
      model1: {
        avgLatency: m1AvgL, stdLatency: stddev(m1Latencies),
        avgQuality: m1AvgQ, stdQuality: stddev(m1Scores),
        bestQuality: Math.max(...m1Scores),
        bestText: best1?.text || '',
      },
      model2: {
        avgLatency: m2AvgL, stdLatency: stddev(m2Latencies),
        avgQuality: m2AvgQ, stdQuality: stddev(m2Scores),
        bestQuality: Math.max(...m2Scores),
        bestText: best2?.text || '',
      },
      winner,
    };
  }
}

// Global singleton — persists across component mounts/unmounts
export const aiEditQueue = new AIEditQueueManager();

// Auto-initialize when module loads
aiEditQueue.init();
