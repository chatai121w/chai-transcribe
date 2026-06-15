import { useCallback, useEffect, useState } from 'react';
import { aiEditQueue, type AIEditJob } from '@/lib/aiEditQueue';

/**
 * React hook that subscribes to the global AI edit background queue.
 * Re-renders whenever a job changes (progress, completion, failure).
 */
export function useAIEditQueue() {
  const [jobs, setJobs] = useState<AIEditJob[]>(() => aiEditQueue.getAll());

  useEffect(() => {
    // Initialize (idempotent)
    aiEditQueue.init();
    setJobs(aiEditQueue.getAll());

    const unsub = aiEditQueue.subscribe(() => {
      setJobs(aiEditQueue.getAll());
    });
    return unsub;
  }, []);

  const enqueue = useCallback(
    (...args: Parameters<typeof aiEditQueue.enqueue>) => aiEditQueue.enqueue(...args),
    [],
  );
  const cancel = useCallback((id: string) => aiEditQueue.cancel(id), []);
  const resume = useCallback((id: string) => aiEditQueue.resume(id), []);
  const remove = useCallback((id: string) => aiEditQueue.remove(id), []);
  const clearFinished = useCallback(() => aiEditQueue.clearFinished(), []);

  const pendingCount = jobs.filter(j => j.status === 'pending').length;
  const runningCount = jobs.filter(j => j.status === 'running').length;
  const activeCount = pendingCount + runningCount;

  return {
    jobs,
    enqueue,
    cancel,
    resume,
    remove,
    clearFinished,
    pendingCount,
    runningCount,
    activeCount,
    getJob: (id: string) => jobs.find(j => j.id === id),
  };
}
