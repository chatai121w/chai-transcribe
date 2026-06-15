const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB

export interface AudioChunk {
  blob: Blob;
  index: number;
  total: number;
}

/**
 * Split a file into chunks of up to CHUNK_SIZE bytes.
 * Uses Blob.slice - works for any binary file.
 */
export function splitFileIntoChunks(file: File, maxSize = CHUNK_SIZE): AudioChunk[] {
  if (file.size <= maxSize) {
    return [{ blob: file, index: 0, total: 1 }];
  }

  const chunks: AudioChunk[] = [];
  const total = Math.ceil(file.size / maxSize);

  for (let i = 0; i < total; i++) {
    const start = i * maxSize;
    const end = Math.min(start + maxSize, file.size);
    chunks.push({
      blob: file.slice(start, end, file.type || 'audio/webm'),
      index: i,
      total,
    });
  }

  return chunks;
}

/**
 * Run async tasks with a concurrency limit.
 */
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
