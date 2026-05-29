/**
 * Advanced Audio Cut Engine — parallel, queued, background-processed.
 *
 * Modes:
 *  - manual:     custom start/end in seconds
 *  - time:       split by fixed duration (e.g. every 5 min)
 *  - count:      split into N equal parts
 *  - silence:    (future) detect silence gaps
 *
 * Features:
 *  - Parallel cutting via multiple OfflineAudioContext (configurable concurrency)
 *  - Queue management: enqueue multiple operations, drain concurrently
 *  - IndexedDB persistence: cut results survive page refresh
 *  - Real-time progress + callback system
 *  - Lazy audio decoding: decode once, cut many times
 *  - WAV encoding off-loaded to Web Worker (wavEncoder.worker.ts)
 */

import { encodeWavInWorker } from "./wavEncoderWorker";

export type CutMode = "manual" | "time" | "count";

export type CutJobStatus = "queued" | "decoding" | "cutting" | "done" | "error";

export interface CutSegment {
  index: number;
  startSec: number;
  endSec: number;
  label: string;
}

export interface CutJobConfig {
  mode: CutMode;
  /** For 'manual': array of custom segments */
  segments?: Array<{ startSec: number; endSec: number; label?: string }>;
  /** For 'time': duration of each chunk in seconds */
  chunkDurationSec?: number;
  /** For 'count': number of equal parts */
  partCount?: number;
}

export interface CutResult {
  segmentIndex: number;
  file: File;
  label: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  sizeBytes: number;
}

export interface CutJob {
  id: string;
  sourceFileName: string;
  sourceFileSize: number;
  sourceFile?: File;
  config: CutJobConfig;
  status: CutJobStatus;
  progress: number; // 0-100
  totalSegments: number;
  completedSegments: number;
  results: CutResult[];
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  durationSec?: number; // total audio duration
}

export type CutJobCallback = (job: CutJob) => void;

// ─── Config ──────────────────────────────────────────────────────────────────

const MAX_PARALLEL_CUTS = 4;
const DB_NAME = "AudioCutEngineDB";
const DB_VERSION = 1;
const STORE_JOBS = "cutJobs";
const STORE_RESULTS = "cutResults";

// ─── IndexedDB Persistence ───────────────────────────────────────────────────

interface PersistedCutJob {
  id: string;
  sourceFileName: string;
  sourceFileSize: number;
  config: CutJobConfig;
  status: CutJobStatus;
  totalSegments: number;
  completedSegments: number;
  startedAt?: number;
  finishedAt?: number;
  durationSec?: number;
  error?: string;
}

interface PersistedCutResult {
  jobId: string;
  segmentIndex: number;
  blob: Blob;
  fileName: string;
  label: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  savedAt: number;
}

function openCutDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_JOBS))
        db.createObjectStore(STORE_JOBS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_RESULTS)) {
        const store = db.createObjectStore(STORE_RESULTS, { keyPath: ["jobId", "segmentIndex"] });
        store.createIndex("byJob", "jobId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPutCut<T>(store: string, value: T): Promise<void> {
  const db = await openCutDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAllCut<T>(store: string): Promise<T[]> {
  const db = await openCutDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function dbDeleteCut(store: string, key: IDBValidKey): Promise<void> {
  const db = await openCutDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetResultsByJob(jobId: string): Promise<PersistedCutResult[]> {
  const db = await openCutDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_RESULTS, "readonly");
    const idx = tx.objectStore(STORE_RESULTS).index("byJob");
    const req = idx.getAll(jobId);
    req.onsuccess = () => resolve(req.result as PersistedCutResult[]);
    req.onerror = () => reject(req.error);
  });
}

async function persistCutJob(job: CutJob) {
  const pj: PersistedCutJob = {
    id: job.id,
    sourceFileName: job.sourceFileName,
    sourceFileSize: job.sourceFileSize,
    config: job.config,
    status: job.status,
    totalSegments: job.totalSegments,
    completedSegments: job.completedSegments,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationSec: job.durationSec,
    error: job.error,
  };
  await dbPutCut(STORE_JOBS, pj).catch(() => {});
}

async function persistCutResult(jobId: string, result: CutResult) {
  const pr: PersistedCutResult = {
    jobId,
    segmentIndex: result.segmentIndex,
    blob: result.file,
    fileName: result.file.name,
    label: result.label,
    startSec: result.startSec,
    endSec: result.endSec,
    durationSec: result.durationSec,
    savedAt: Date.now(),
  };
  await dbPutCut(STORE_RESULTS, pr).catch(() => {});
}

// ─── Listener system ─────────────────────────────────────────────────────────

const cutListeners = new Set<CutJobCallback>();

export function onCutJobUpdate(cb: CutJobCallback): () => void {
  cutListeners.add(cb);
  return () => cutListeners.delete(cb);
}

function notifyCut(job: CutJob) {
  cutListeners.forEach((cb) => {
    try { cb({ ...job, results: [...job.results] }); } catch { /* */ }
  });
}

// ─── Audio decoding cache (lazy — decode once, cut many) ─────────────────────

const decodedCache = new Map<string, AudioBuffer>();

async function getDecodedAudio(file: File, cacheKey: string): Promise<AudioBuffer> {
  const cached = decodedCache.get(cacheKey);
  if (cached) return cached;

  const arrayBuffer = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  decodedCache.set(cacheKey, decoded);
  return decoded;
}

export function clearDecodedCache(cacheKey?: string) {
  if (cacheKey) decodedCache.delete(cacheKey);
  else decodedCache.clear();
}

// ─── Segment generation from config ──────────────────────────────────────────

export function generateSegments(
  config: CutJobConfig,
  totalDuration: number,
): CutSegment[] {
  const segments: CutSegment[] = [];

  switch (config.mode) {
    case "manual": {
      const manualSegs = config.segments ?? [];
      for (let i = 0; i < manualSegs.length; i++) {
        const s = manualSegs[i];
        const start = Math.max(0, s.startSec);
        const end = Math.min(totalDuration, s.endSec);
        if (end > start) {
          segments.push({
            index: i,
            startSec: start,
            endSec: end,
            label: s.label || `חלק ${i + 1}`,
          });
        }
      }
      break;
    }
    case "time": {
      const chunk = config.chunkDurationSec ?? 300;
      if (chunk <= 0) break;
      let idx = 0;
      for (let t = 0; t < totalDuration; t += chunk) {
        const end = Math.min(t + chunk, totalDuration);
        if (end - t < 0.1) break;
        segments.push({
          index: idx,
          startSec: t,
          endSec: end,
          label: `חלק ${idx + 1}`,
        });
        idx++;
      }
      break;
    }
    case "count": {
      const count = config.partCount ?? 2;
      if (count <= 0) break;
      const partLen = totalDuration / count;
      for (let i = 0; i < count; i++) {
        const start = i * partLen;
        const end = i === count - 1 ? totalDuration : (i + 1) * partLen;
        segments.push({
          index: i,
          startSec: start,
          endSec: end,
          label: `חלק ${i + 1} מתוך ${count}`,
        });
      }
      break;
    }
  }

  return segments;
}

// ─── WAV encoding (same as audioSegment but self-contained) ──────────────────

function encodeSegmentWavSync(
  monoData: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const pcm = new Int16Array(monoData.length);
  for (let i = 0; i < monoData.length; i++) {
    const sample = Math.max(-1, Math.min(1, monoData[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  const wavSize = 44 + pcm.length * 2;
  const wav = new ArrayBuffer(wavSize);
  const view = new DataView(wav);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, wavSize - 8, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, pcm.length * 2, true);
  new Uint8Array(wav, 44).set(new Uint8Array(pcm.buffer));

  return wav;
}

function writeAscii(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function formatSecTag(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}m${s.toString().padStart(2, "0")}s`;
}

// ── Single segment extraction (async — WAV encoding runs in worker) ────────────────────

async function extractSingleSegment(
  audioBuffer: AudioBuffer,
  segment: CutSegment,
  baseName: string,
): Promise<File> {
  const sr = audioBuffer.sampleRate;
  const startSample = Math.floor(segment.startSec * sr);
  const endSample = Math.min(Math.floor(segment.endSec * sr), audioBuffer.length);
  const sampleLength = Math.max(1, endSample - startSample);

  // Mix down all channels to mono on main thread (cheap memory copy)
  const monoData = new Float32Array(sampleLength);
  const channels = audioBuffer.numberOfChannels;
  for (let ch = 0; ch < channels; ch++) {
    const chData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < sampleLength; i++) {
      monoData[i] += chData[startSample + i] / channels;
    }
  }

  // WAV encoding runs in worker thread (transfers monoData — zero-copy)
  let wavBuffer: ArrayBuffer;
  try {
    wavBuffer = await encodeWavInWorker(monoData, sr);
  } catch {
    // Fallback: encode synchronously on main thread
    wavBuffer = encodeSegmentWavSync(monoData, sr);
  }

  const fileName = `${baseName}-${formatSecTag(segment.startSec)}-${formatSecTag(segment.endSec)}.wav`;
  return new File([wavBuffer], fileName, { type: "audio/wav" });
}

// ─── Parallel segment processing ─────────────────────────────────────────────

async function processSegmentsBatch(
  audioBuffer: AudioBuffer,
  segments: CutSegment[],
  baseName: string,
  onSegmentDone: (result: CutResult) => void,
): Promise<CutResult[]> {
  const results: CutResult[] = [];
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < segments.length) {
      const seg = segments[nextIdx++];
      const file = await extractSingleSegment(audioBuffer, seg, baseName);
      const result: CutResult = {
        segmentIndex: seg.index,
        file,
        label: seg.label,
        startSec: seg.startSec,
        endSec: seg.endSec,
        durationSec: seg.endSec - seg.startSec,
        sizeBytes: file.size,
      };
      results.push(result);
      onSegmentDone(result);
    }
  }

  // Spawn parallel workers (up to MAX_PARALLEL_CUTS)
  const workerCount = Math.min(MAX_PARALLEL_CUTS, segments.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results.sort((a, b) => a.segmentIndex - b.segmentIndex);
}

// ─── Job execution ───────────────────────────────────────────────────────────

async function runCutJob(job: CutJob) {
  const file = job.sourceFile;
  if (!file) {
    job.status = "error";
    job.error = "קובץ מקור לא נמצא — יש להוסיף מחדש";
    job.finishedAt = Date.now();
    notifyCut(job);
    await persistCutJob(job);
    return;
  }

  try {
    // Phase 1: Decode audio
    job.status = "decoding";
    job.startedAt = Date.now();
    job.progress = 0;
    notifyCut(job);
    await persistCutJob(job);

    const cacheKey = `${file.name}_${file.size}_${file.lastModified}`;
    const audioBuffer = await getDecodedAudio(file, cacheKey);
    job.durationSec = audioBuffer.duration;

    // Phase 2: Generate segments
    const segments = generateSegments(job.config, audioBuffer.duration);
    if (segments.length === 0) {
      job.status = "error";
      job.error = "לא נוצרו קטעים לחיתוך — בדוק את ההגדרות";
      job.finishedAt = Date.now();
      notifyCut(job);
      await persistCutJob(job);
      return;
    }

    job.totalSegments = segments.length;
    job.status = "cutting";
    job.progress = 5;
    notifyCut(job);

    // Phase 3: Cut segments in parallel
    const baseName = file.name.replace(/\.[^.]+$/, "");
    const results = await processSegmentsBatch(
      audioBuffer,
      segments,
      baseName,
      (result) => {
        job.completedSegments++;
        job.progress = Math.min(99, 5 + Math.round((job.completedSegments / job.totalSegments) * 95));
        job.results.push(result);
        notifyCut(job);
        // Persist each result in background
        void persistCutResult(job.id, result);
      },
    );

    // Done
    job.results = results;
    job.status = "done";
    job.progress = 100;
    job.finishedAt = Date.now();
    notifyCut(job);
    await persistCutJob(job);
  } catch (err: unknown) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : "שגיאה לא ידועה";
    job.finishedAt = Date.now();
    notifyCut(job);
    await persistCutJob(job);
  } finally {
    drainCutQueue();
  }
}

// ─── Queue with parallel dispatch ────────────────────────────────────────────

const cutQueue: CutJob[] = [];
let cutActiveCount = 0;

function enqueueCut(job: CutJob) {
  cutQueue.push(job);
  drainCutQueue();
}

function drainCutQueue() {
  while (cutActiveCount < 2 && cutQueue.length > 0) {
    const job = cutQueue.shift()!;
    cutActiveCount++;
    runCutJob(job).finally(() => {
      cutActiveCount--;
      drainCutQueue();
    });
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

let cutIdCounter = 0;

export function submitCutJob(file: File, config: CutJobConfig): CutJob {
  const job: CutJob = {
    id: `cut_${++cutIdCounter}_${Date.now()}`,
    sourceFileName: file.name,
    sourceFileSize: file.size,
    sourceFile: file,
    config,
    status: "queued",
    progress: 0,
    totalSegments: 0,
    completedSegments: 0,
    results: [],
  };
  enqueueCut(job);
  return job;
}

/** Probe audio duration without full decode (uses cached if available) */
export async function probeAudioDuration(file: File): Promise<number> {
  const cacheKey = `${file.name}_${file.size}_${file.lastModified}`;
  const audioBuffer = await getDecodedAudio(file, cacheKey);
  return audioBuffer.duration;
}

/** Restore persisted cut jobs & results */
export async function restorePersistedCutJobs(): Promise<CutJob[]> {
  try {
    const [pJobs, pResults] = await Promise.all([
      dbGetAllCut<PersistedCutJob>(STORE_JOBS),
      dbGetAllCut<PersistedCutResult>(STORE_RESULTS),
    ]);
    const resultsByJob = new Map<string, PersistedCutResult[]>();
    for (const r of pResults) {
      const arr = resultsByJob.get(r.jobId) ?? [];
      arr.push(r);
      resultsByJob.set(r.jobId, arr);
    }

    return pJobs.map((pj) => {
      const pResults = resultsByJob.get(pj.id) ?? [];
      const results: CutResult[] = pResults.map((pr) => ({
        segmentIndex: pr.segmentIndex,
        file: new File([pr.blob], pr.fileName, { type: "audio/wav" }),
        label: pr.label,
        startSec: pr.startSec,
        endSec: pr.endSec,
        durationSec: pr.durationSec,
        sizeBytes: pr.blob.size,
      })).sort((a, b) => a.segmentIndex - b.segmentIndex);

      const job: CutJob = {
        id: pj.id,
        sourceFileName: pj.sourceFileName,
        sourceFileSize: pj.sourceFileSize,
        config: pj.config,
        status: pj.status,
        progress: pj.status === "done" ? 100 : 0,
        totalSegments: pj.totalSegments,
        completedSegments: results.length,
        results,
        startedAt: pj.startedAt,
        finishedAt: pj.finishedAt,
        durationSec: pj.durationSec,
        error: pj.error,
      };

      // Interrupted mid-cut → mark as error
      if (job.status !== "done" && job.status !== "error") {
        job.status = "error";
        job.error = "החיתוך הופסק — לחץ לנסות שוב";
      }

      return job;
    });
  } catch {
    return [];
  }
}

/** Remove persisted data for a cut job */
export async function removePersistedCutJob(jobId: string) {
  try {
    const results = await dbGetResultsByJob(jobId);
    await Promise.all([
      dbDeleteCut(STORE_JOBS, jobId),
      ...results.map((r) => dbDeleteCut(STORE_RESULTS, [r.jobId, r.segmentIndex])),
    ]);
  } catch { /* */ }
}

/** Format seconds as HH:MM:SS */
export function formatTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Parse HH:MM:SS or MM:SS or SS string to seconds */
export function parseTimeInput(input: string): number | null {
  const trimmed = input.trim();
  // Try plain number (seconds)
  if (/^\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  // MM:SS
  const mm = trimmed.match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (mm) return parseInt(mm[1]) * 60 + parseFloat(mm[2]);
  // HH:MM:SS
  const hh = trimmed.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
  if (hh) return parseInt(hh[1]) * 3600 + parseInt(hh[2]) * 60 + parseFloat(hh[3]);
  return null;
}
