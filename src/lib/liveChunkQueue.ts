export interface LiveChunkJob {
  blob: Blob;
  offsetSec: number;
  averageLevel: number;
  attempts: number;
}

export type LiveChunkProcessor = (job: LiveChunkJob) => Promise<"done" | "retry">;

interface LiveChunkQueueOptions {
  process: LiveChunkProcessor;
  maxAttempts?: number;
  retryDelayMs?: number;
  onDepthChange?: (depth: number) => void;
  onDropped?: (job: LiveChunkJob) => void;
}

/** Serial audio queue. Recording can keep enqueueing while network/GPU work is in flight. */
export class LiveChunkQueue {
  private readonly jobs: LiveChunkJob[] = [];
  private readonly waiters = new Set<() => void>();
  private draining = false;
  private stopped = false;

  constructor(private readonly options: LiveChunkQueueOptions) {}

  enqueue(job: Omit<LiveChunkJob, "attempts">): void {
    if (this.stopped) return;
    this.jobs.push({ ...job, attempts: 0 });
    this.emitDepth();
    void this.drain();
  }

  get depth(): number {
    return this.jobs.length + (this.draining ? 1 : 0);
  }

  async idle(): Promise<void> {
    if (!this.draining && this.jobs.length === 0) return;
    await new Promise<void>((resolve) => this.waiters.add(resolve));
  }

  clear(): void {
    this.jobs.splice(0);
    this.emitDepth();
    this.resolveIfIdle();
  }

  stop(): void {
    this.stopped = true;
    this.clear();
  }

  private async drain(): Promise<void> {
    if (this.draining || this.stopped) return;
    this.draining = true;
    this.emitDepth();
    try {
      while (!this.stopped && this.jobs.length > 0) {
        const job = this.jobs.shift()!;
        this.emitDepth();
        let result: "done" | "retry" = "done";
        try {
          result = await this.options.process(job);
        } catch {
          result = "retry";
        }
        if (result === "retry") {
          job.attempts += 1;
          if (job.attempts < (this.options.maxAttempts ?? 3)) {
            await new Promise((resolve) => setTimeout(resolve, this.options.retryDelayMs ?? 750));
            this.jobs.unshift(job);
          } else {
            this.options.onDropped?.(job);
          }
        }
      }
    } finally {
      this.draining = false;
      this.emitDepth();
      this.resolveIfIdle();
      if (!this.stopped && this.jobs.length > 0) void this.drain();
    }
  }

  private emitDepth(): void {
    this.options.onDepthChange?.(this.depth);
  }

  private resolveIfIdle(): void {
    if (this.draining || this.jobs.length > 0) return;
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }
}
