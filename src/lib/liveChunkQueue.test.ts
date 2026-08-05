import { describe, expect, it, vi } from "vitest";
import { LiveChunkQueue } from "./liveChunkQueue";

const chunk = (id: number) => ({
  blob: new Blob([String(id)]),
  offsetSec: id,
  averageLevel: 20,
});

describe("LiveChunkQueue", () => {
  it("keeps FIFO order when processing is slower than capture", async () => {
    const processed: number[] = [];
    const queue = new LiveChunkQueue({
      process: async (job) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        processed.push(job.offsetSec);
        return "done";
      },
    });

    queue.enqueue(chunk(1));
    queue.enqueue(chunk(2));
    queue.enqueue(chunk(3));
    await queue.idle();

    expect(processed).toEqual([1, 2, 3]);
    expect(queue.depth).toBe(0);
  });

  it("retries without replacing later chunks", async () => {
    const processed: number[] = [];
    let firstAttempt = true;
    const queue = new LiveChunkQueue({
      retryDelayMs: 0,
      process: async (job) => {
        if (job.offsetSec === 1 && firstAttempt) {
          firstAttempt = false;
          return "retry";
        }
        processed.push(job.offsetSec);
        return "done";
      },
    });

    queue.enqueue(chunk(1));
    queue.enqueue(chunk(2));
    await queue.idle();

    expect(processed).toEqual([1, 2]);
  });

  it("reports a chunk only after retry budget is exhausted", async () => {
    const dropped = vi.fn();
    const queue = new LiveChunkQueue({
      maxAttempts: 2,
      retryDelayMs: 0,
      process: async () => "retry",
      onDropped: dropped,
    });

    queue.enqueue(chunk(1));
    await queue.idle();

    expect(dropped).toHaveBeenCalledOnce();
    expect(dropped.mock.calls[0][0].attempts).toBe(2);
  });
});
