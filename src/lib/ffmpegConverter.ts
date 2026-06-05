/**
 * FFmpeg WASM converter v2 – parallel, persistent, resumable.
 *
 * - Multiple FFmpeg WASM instances run in parallel (up to 3)
 * - Queue + results persisted to IndexedDB (survive page refresh)
 * - Failed jobs can be retried; interrupted jobs detected on restore
 * - Real progress via FFmpeg duration detection + time-based tracking
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";
import { chooseConversionPath, convertOnServer, isServerAvailable } from "./conversionRouter";
import { debugLog } from "./debugLogger";

export type JobStatus = "queued" | "loading" | "converting" | "done" | "error";
export type OutputFormat = "mp3" | "opus" | "aac";

interface OutputFormatConfig {
  ext: string;
  mime: string;
  ffmpegArgs: string[];
}

const OUTPUT_FORMAT_CONFIG: Record<OutputFormat, OutputFormatConfig> = {
  mp3: {
    ext: "mp3",
    mime: "audio/mpeg",
    ffmpegArgs: ["-acodec", "libmp3lame", "-ab", "192k", "-ar", "44100", "-ac", "2"],
  },
  opus: {
    ext: "opus",
    mime: "audio/opus",
    ffmpegArgs: ["-c:a", "libopus", "-b:a", "128k", "-vbr", "on", "-compression_level", "5", "-application", "audio"],
  },
  aac: {
    ext: "m4a",
    mime: "audio/mp4",
    ffmpegArgs: ["-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2"],
  },
};

function getOutputFileName(inputName: string, outputFormat: OutputFormat): string {
  const ext = OUTPUT_FORMAT_CONFIG[outputFormat].ext;
  return inputName.replace(/\.[^/.]+$/, "") + `.${ext}`;
}

function getOutputMime(outputFormat: OutputFormat): string {
  return OUTPUT_FORMAT_CONFIG[outputFormat].mime;
}

function getOutputFfmpegArgs(outputFormat: OutputFormat): string[] {
  return OUTPUT_FORMAT_CONFIG[outputFormat].ffmpegArgs;
}

export interface ConversionJob {
  id: string;
  fileName: string;
  fileSize: number;
  outputFormat: OutputFormat;
  file?: File;              // only in-memory, not persisted
  status: JobStatus;
  progress: number;         // 0-100 – real, time-based
  outputBlob?: Blob;
  outputUrl?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  duration?: number;        // total duration in seconds (for real progress)
  retryCount: number;
  conversionPath?: "browser" | "server";  // which engine was used
}

export type JobUpdateCallback = (job: ConversionJob) => void;

const SUPPORTED_EXTENSIONS = new Set([
  "mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v", "3gp", "ogv",
  "ts", "mts", "m2ts", "vob", "mpg", "mpeg",
  "m4a", "wav", "ogg", "flac", "aac", "wma", "opus", "amr",
]);

export function isSupportedFormat(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function getSupportedExtensions(): string[] {
  return [...SUPPORTED_EXTENSIONS];
}

// ─── IndexedDB persistence ───────────────────────────────────────────────────

const DB_NAME = "FFmpegConverterDB";
const DB_VERSION = 1;
const STORE_JOBS = "jobs";
const STORE_OUTPUTS = "outputs";

interface PersistedJob {
  id: string;
  fileName: string;
  fileSize: number;
  outputFormat?: OutputFormat;
  status: JobStatus;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  retryCount: number;
}

interface PersistedOutput {
  jobId: string;
  blob: Blob;
  fileName: string;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_JOBS)) db.createObjectStore(STORE_JOBS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE_OUTPUTS)) db.createObjectStore(STORE_OUTPUTS, { keyPath: "jobId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut<T>(store: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function persistJob(job: ConversionJob) {
  const pj: PersistedJob = {
    id: job.id, fileName: job.fileName, fileSize: job.fileSize,
    outputFormat: job.outputFormat,
    status: job.status, startedAt: job.startedAt,
    finishedAt: job.finishedAt, error: job.error, retryCount: job.retryCount,
  };
  await dbPut(STORE_JOBS, pj).catch(() => {});
}

async function persistOutput(jobId: string, blob: Blob, fileName: string) {
  await dbPut(STORE_OUTPUTS, { jobId, blob, fileName, savedAt: Date.now() } as PersistedOutput).catch(() => {});
}

/** Restore completed/failed jobs from IndexedDB on page load */
export async function restorePersistedJobs(): Promise<ConversionJob[]> {
  try {
    const [pJobs, pOutputs] = await Promise.all([
      dbGetAll<PersistedJob>(STORE_JOBS),
      dbGetAll<PersistedOutput>(STORE_OUTPUTS),
    ]);
    const outputMap = new Map(pOutputs.map((o) => [o.jobId, o]));
    return pJobs.map((pj) => {
      const output = outputMap.get(pj.id);
      const job: ConversionJob = {
        id: pj.id, fileName: pj.fileName, fileSize: pj.fileSize,
        outputFormat: pj.outputFormat ?? "mp3",
        status: pj.status, progress: pj.status === "done" ? 100 : 0,
        startedAt: pj.startedAt, finishedAt: pj.finishedAt,
        error: pj.error, retryCount: pj.retryCount,
      };
      if (output) {
        job.outputBlob = output.blob;
        job.outputUrl = URL.createObjectURL(output.blob);
      }
      // Interrupted mid-conversion → mark as error so user can retry
      if (job.status !== "done" && job.status !== "error") {
        job.status = "error";
        job.error = "ההמרה הופסקה — לחץ לנסות שוב";
      }
      return job;
    });
  } catch {
    return [];
  }
}

/** Remove persisted data for a job */
export async function removePersistedJob(jobId: string) {
  await Promise.all([dbDelete(STORE_JOBS, jobId), dbDelete(STORE_OUTPUTS, jobId)]).catch(() => {});
}

// ─── FFmpeg instance pool for parallelism ────────────────────────────────────

// Local import from installed @ffmpeg/core (served by Vite from node_modules)
import coreUrl from "@ffmpeg/core?url";
import wasmUrl from "@ffmpeg/core/wasm?url";

let cachedCoreURL: string | null = null;
let cachedWasmURL: string | null = null;

async function loadCoreUrls() {
  if (cachedCoreURL && cachedWasmURL) {
    return { coreURL: cachedCoreURL, wasmURL: cachedWasmURL };
  }

  // Primary: load from local node_modules (bundled by Vite)
  try {
    const [coreBlobURL, wasmBlobURL] = await Promise.all([
      toBlobURL(coreUrl, "text/javascript"),
      toBlobURL(wasmUrl, "application/wasm"),
    ]);
    cachedCoreURL = coreBlobURL;
    cachedWasmURL = wasmBlobURL;
    return { coreURL: cachedCoreURL, wasmURL: cachedWasmURL };
  } catch (localErr) {
    console.warn("[FFmpeg] Local core load failed, trying CDN fallback...", localErr);
  }

  // Fallback: CDN (core + wasm only, no worker file in single-threaded package)
  const CDN_BASES = [
    "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm",
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
  ];

  let lastErr: unknown;
  for (const base of CDN_BASES) {
    try {
      const [coreBlobURL, wasmBlobURL] = await Promise.all([
        toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      ]);
      cachedCoreURL = coreBlobURL;
      cachedWasmURL = wasmBlobURL;
      return { coreURL: cachedCoreURL, wasmURL: cachedWasmURL };
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("Failed to load FFmpeg core assets from local bundle and CDN fallbacks");
}

async function createFFmpegInstance(): Promise<FFmpeg> {
  const ffmpeg = new FFmpeg();
  const { coreURL, wasmURL } = await loadCoreUrls();
  await ffmpeg.load({ coreURL, wasmURL });
  return ffmpeg;
}

const instancePool: FFmpeg[] = [];
const MAX_PARALLEL = 3;
let createdCount = 0;
const waiters: Array<(inst: FFmpeg) => void> = [];

async function acquireFFmpeg(): Promise<FFmpeg> {
  const available = instancePool.pop();
  if (available) return available;
  if (createdCount < MAX_PARALLEL) {
    createdCount++;
    return createFFmpegInstance();
  }
  // Wait for a released instance
  return new Promise((resolve) => { waiters.push(resolve); });
}

function releaseFFmpeg(inst: FFmpeg) {
  const waiter = waiters.shift();
  if (waiter) { waiter(inst); }
  else { instancePool.push(inst); }
}

// ─── Global listeners ────────────────────────────────────────────────────────

const listeners = new Set<JobUpdateCallback>();

export function onJobUpdate(cb: JobUpdateCallback): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notifyAll(job: ConversionJob) {
  listeners.forEach((cb) => { try { cb({ ...job }); } catch { /* */ } });
}

// ─── Real progress parsing from FFmpeg logs ──────────────────────────────────

function parseDuration(msg: string): number | null {
  const m = msg.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
}

function parseTime(msg: string): number | null {
  const m = msg.match(/time=\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
}

// ─── Conversion engine ──────────────────────────────────────────────────────

async function runServerConversion(job: ConversionJob): Promise<boolean> {
  const file = job.file!;
  try {
    debugLog.info("FFmpegConverter", "Trying server conversion", {
      jobId: job.id,
      fileName: file.name,
      fileSize: file.size,
      outputFormat: job.outputFormat,
    });
    job.conversionPath = "server";
    job.status = "converting";
    job.progress = 0;
    notifyAll(job);

    const blob = await convertOnServer(file, job.outputFormat, (p) => {
      job.progress = Math.min(99, p.progress);
      notifyAll(job);
    });

    const url = URL.createObjectURL(blob);
    job.status = "done";
    job.progress = 100;
    job.outputBlob = blob;
    job.outputUrl = url;
    job.finishedAt = Date.now();
    notifyAll(job);
    debugLog.info("FFmpegConverter", "Server conversion completed", {
      jobId: job.id,
      outputBytes: blob.size,
      outputType: blob.type,
    });

    const outputName = getOutputFileName(file.name, job.outputFormat);
    await Promise.all([persistJob(job), persistOutput(job.id, blob, outputName)]);
    return true;
  } catch (error) {
    debugLog.warn("FFmpegConverter", "Server conversion failed, will fallback", {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
      outputFormat: job.outputFormat,
    });
    return false; // caller will fallback to WASM
  }
}

async function runWasmConversion(job: ConversionJob): Promise<void> {
  const file = job.file;
  if (!file) {
    job.status = "error";
    job.error = "קובץ לא נמצא — יש להוסיף מחדש";
    job.finishedAt = Date.now();
    notifyAll(job);
    await persistJob(job);
    return;
  }

  let ffmpeg: FFmpeg | null = null;
  try {
    debugLog.info("FFmpegConverter", "Starting browser conversion", {
      jobId: job.id,
      fileName: file.name,
      fileSize: file.size,
      outputFormat: job.outputFormat,
    });
    job.conversionPath = "browser";
    job.status = "loading";
    job.startedAt = Date.now();
    job.progress = 0;
    notifyAll(job);
    await persistJob(job);

    ffmpeg = await acquireFFmpeg();

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "mp4";
    const inputName = `in_${job.id}.${ext}`;
    const outputExt = OUTPUT_FORMAT_CONFIG[job.outputFormat].ext;
    const outputName = `out_${job.id}.${outputExt}`;

    const data = await fetchFile(file);
    await ffmpeg.writeFile(inputName, data);

    job.status = "converting";
    notifyAll(job);
    await persistJob(job);

    // Real progress via log parsing + error capture
    let totalDuration = 0;
    const ffmpegLogs: string[] = [];
    const onLog = ({ message }: { message: string }) => {
      ffmpegLogs.push(message);
      if (!totalDuration) {
        const d = parseDuration(message);
        if (d && d > 0) { totalDuration = d; job.duration = d; }
      }
      const t = parseTime(message);
      if (t !== null && totalDuration > 0) {
        job.progress = Math.min(99, Math.round((t / totalDuration) * 100));
        notifyAll(job);
      }
    };
    ffmpeg.on("log", onLog);

    // Fallback progress from built-in event
    const onProgress = ({ progress }: { progress: number }) => {
      if (!totalDuration) {
        job.progress = Math.min(99, Math.round(progress * 100));
        notifyAll(job);
      }
    };
    ffmpeg.on("progress", onProgress);

    const exitCode = await ffmpeg.exec([
      "-i", inputName, "-vn",
      ...getOutputFfmpegArgs(job.outputFormat),
      outputName,
    ]);

    ffmpeg.off("log", onLog);
    ffmpeg.off("progress", onProgress);

    if (exitCode !== 0) {
      const lastLogs = ffmpegLogs.slice(-10).join("\n");
      debugLog.error("FFmpegConverter", "FFmpeg WASM exec failed", {
        jobId: job.id,
        exitCode,
        outputFormat: job.outputFormat,
        lastLogs,
      });
      throw new Error(`FFmpeg failed (exit ${exitCode}): ${lastLogs}`);
    }

    const outputData = await ffmpeg.readFile(outputName);
    const bytes = outputData instanceof Uint8Array ? outputData : new TextEncoder().encode(outputData as string);
    const blob = new Blob([new Uint8Array(bytes)], { type: getOutputMime(job.outputFormat) });
    const url = URL.createObjectURL(blob);

    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});

    job.status = "done";
    job.progress = 100;
    job.outputBlob = blob;
    job.outputUrl = url;
    job.finishedAt = Date.now();
    notifyAll(job);
    debugLog.info("FFmpegConverter", "Browser conversion completed", {
      jobId: job.id,
      outputBytes: blob.size,
      outputType: blob.type,
      durationSec: job.duration,
    });

    const outputNameForSave = getOutputFileName(file.name, job.outputFormat);
    await Promise.all([persistJob(job), persistOutput(job.id, blob, outputNameForSave)]);
  } catch (err: unknown) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err) || "שגיאה לא ידועה בהמרה";
    job.finishedAt = Date.now();
    notifyAll(job);
    debugLog.error("FFmpegConverter", "Browser conversion failed", {
      jobId: job.id,
      error: job.error,
      outputFormat: job.outputFormat,
    });
    await persistJob(job);
  } finally {
    if (ffmpeg) releaseFFmpeg(ffmpeg);
    drainQueue();
  }
}

/** Hybrid orchestrator: choose path, try server for large files, fallback to WASM. */
async function runConversion(job: ConversionJob) {
  const file = job.file;
  if (!file) {
    job.status = "error";
    job.error = "קובץ לא נמצא — יש להוסיף מחדש";
    job.finishedAt = Date.now();
    notifyAll(job);
    await persistJob(job);
    return;
  }

  job.startedAt = Date.now();
  let path = await chooseConversionPath(file.size);
  debugLog.info("FFmpegConverter", "Initial conversion path selected", {
    jobId: job.id,
    path,
    fileSize: file.size,
    outputFormat: job.outputFormat,
  });

  // OPUS encoding is less reliable in browser WASM on some devices.
  // If server FFmpeg is available, prefer it for OPUS.
  if (job.outputFormat === "opus" && path === "browser") {
    try {
      const serverReady = await isServerAvailable();
      if (serverReady) {
        path = "server";
        debugLog.info("FFmpegConverter", "OPUS prefers server when available", {
          jobId: job.id,
          path,
        });
      }
    } catch {
      // keep browser path as fallback
    }
  }

  if (path === "server") {
    const ok = await runServerConversion(job);
    if (ok) return;
    // Server failed — reset and fallback to WASM
    debugLog.warn("FFmpegConverter", "Falling back from server to browser", {
      jobId: job.id,
      outputFormat: job.outputFormat,
    });
    job.status = "queued";
    job.progress = 0;
    job.error = undefined;
    job.conversionPath = undefined;
    notifyAll(job);
  }

  await runWasmConversion(job);

  if (job.status === "error" && job.outputFormat === "opus") {
    const msg = (job.error || "").toLowerCase();
    if (msg.includes("libopus") || msg.includes("unknown encoder") || msg.includes("encoder") || msg.includes("not found")) {
      job.error = "OPUS נכשל במנוע הדפדפן (encoder לא זמין). נסה להפעיל שרת מקומי ולהמיר שוב.";
      notifyAll(job);
      debugLog.warn("FFmpegConverter", "OPUS browser encoder unavailable", {
        jobId: job.id,
        error: msg,
      });
      await persistJob(job);
    }
  }
}

// ─── Queue with parallel dispatch ────────────────────────────────────────────

const queue: ConversionJob[] = [];
let activeCount = 0;

function enqueue(job: ConversionJob) {
  queue.push(job);
  drainQueue();
}

function drainQueue() {
  while (activeCount < MAX_PARALLEL && queue.length > 0) {
    const job = queue.shift()!;
    activeCount++;
    runConversion(job).finally(() => { activeCount--; drainQueue(); });
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

let idCounter = 0;

export function convertToMp3(file: File): ConversionJob {
  return convertAudio(file, "mp3");
}

export function convertAudio(file: File, outputFormat: OutputFormat = "mp3"): ConversionJob {
  const job: ConversionJob = {
    id: `conv_${++idCounter}_${Date.now()}`,
    fileName: file.name,
    fileSize: file.size,
    outputFormat,
    file,
    status: "queued",
    progress: 0,
    retryCount: 0,
  };
  enqueue(job);
  return job;
}

/** Retry a failed job — requires the original File object */
export function retryJob(job: ConversionJob, file: File): ConversionJob {
  job.file = file;
  job.status = "queued";
  job.progress = 0;
  job.error = undefined;
  job.finishedAt = undefined;
  job.retryCount++;
  notifyAll(job);
  enqueue(job);
  return job;
}

export function revokeJobUrl(job: ConversionJob) {
  if (job.outputUrl) URL.revokeObjectURL(job.outputUrl);
}

/** Pre-load FFmpeg WASM core URLs */
export async function preloadFFmpeg(): Promise<void> {
  await loadCoreUrls();
}

export function getMaxParallel(): number {
  return MAX_PARALLEL;
}
