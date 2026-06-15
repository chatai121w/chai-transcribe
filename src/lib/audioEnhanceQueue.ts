import {
  enhanceAudioOnServer,
  type EnhancementOutputFormat,
  type EnhancementPreset,
} from "@/lib/audioEnhancement";

export type EnhanceQueueJobStatus = "queued" | "enhancing" | "done" | "error";

export interface EnhanceQueueJob {
  id: string;
  sourceName: string;
  sourceSize: number;
  preset: EnhancementPreset;
  outputFormat: EnhancementOutputFormat;
  status: EnhanceQueueJobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  outputFile?: File;
}

interface InternalEnhanceQueueJob extends EnhanceQueueJob {
  sourceFile: File;
}

const MAX_PARALLEL = 2;
const jobMap = new Map<string, InternalEnhanceQueueJob>();
const queue: string[] = [];
let running = 0;

const listeners = new Set<(jobs: EnhanceQueueJob[]) => void>();

function snapshot(): EnhanceQueueJob[] {
  return Array.from(jobMap.values())
    .map((job) => ({
      id: job.id,
      sourceName: job.sourceName,
      sourceSize: job.sourceSize,
      preset: job.preset,
      outputFormat: job.outputFormat,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      outputFile: job.outputFile,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function notify() {
  const jobs = snapshot();
  listeners.forEach((listener) => listener(jobs));
}

function ensureExt(fileName: string, outputFormat: EnhancementOutputFormat): string {
  const ext = outputFormat === "aac" ? "m4a" : outputFormat;
  const stripped = fileName.replace(/\.[^/.]+$/, "");
  return `${stripped}.${ext}`;
}

function enqueueDrain() {
  while (running < MAX_PARALLEL && queue.length > 0) {
    const nextId = queue.shift();
    if (!nextId) continue;
    const job = jobMap.get(nextId);
    if (!job || job.status !== "queued") continue;
    void processJob(job);
  }
}

async function processJob(job: InternalEnhanceQueueJob) {
  running += 1;
  job.status = "enhancing";
  job.startedAt = Date.now();
  job.error = undefined;
  notify();

  try {
    const result = await enhanceAudioOnServer(job.sourceFile, {
      preset: job.preset,
      outputFormat: job.outputFormat,
    });

    const outputName = ensureExt(result.fileName || job.sourceName, job.outputFormat);
    job.outputFile = new File([result.blob], outputName, { type: result.mimeType });
    job.status = "done";
    job.finishedAt = Date.now();
  } catch (err: any) {
    job.status = "error";
    job.error = err?.message || "Unknown enhancement error";
    job.finishedAt = Date.now();
  } finally {
    running -= 1;
    notify();
    enqueueDrain();
  }
}

export function submitEnhanceJob(
  sourceFile: File,
  options: { preset: EnhancementPreset; outputFormat: EnhancementOutputFormat },
): EnhanceQueueJob {
  const id = `enh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job: InternalEnhanceQueueJob = {
    id,
    sourceName: sourceFile.name,
    sourceSize: sourceFile.size,
    preset: options.preset,
    outputFormat: options.outputFormat,
    status: "queued",
    createdAt: Date.now(),
    sourceFile,
  };

  jobMap.set(id, job);
  queue.push(id);
  notify();
  enqueueDrain();
  return job;
}

export function getEnhanceQueueJobs(): EnhanceQueueJob[] {
  return snapshot();
}

export function clearEnhanceQueueCompleted() {
  Array.from(jobMap.values()).forEach((job) => {
    if (job.status === "done" || job.status === "error") {
      jobMap.delete(job.id);
    }
  });
  notify();
}

export function removeEnhanceQueueJob(id: string) {
  const job = jobMap.get(id);
  if (!job) return;
  if (job.status === "enhancing") return;
  jobMap.delete(id);
  const idx = queue.indexOf(id);
  if (idx >= 0) queue.splice(idx, 1);
  notify();
}

export function onEnhanceQueueUpdate(listener: (jobs: EnhanceQueueJob[]) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}
