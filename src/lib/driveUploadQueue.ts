import { supabase } from '@/integrations/supabase/client';
import { db, isDbAvailable, type PendingDriveUpload } from '@/lib/localDb';

export type DriveUploadStatus =
  | 'pending'
  | 'checking'
  | 'awaiting-confirm'
  | 'uploading'
  | 'waiting-network'
  | 'done'
  | 'skipped'
  | 'error';

export interface DriveUploadJob {
  id: string;
  name: string;          // file name on Drive (e.g. "title.txt")
  folderId: string | null;
  folderName: string;
  text: string;
  status: DriveUploadStatus;
  error?: string;
  webViewLink?: string;
  existing?: { id: string; name: string; modifiedTime?: string }[];
  resolution?: 'overwrite' | 'duplicate' | 'skip';
  /** Whether this job is persisted in IndexedDB for background retry */
  persisted?: boolean;
}

export interface UploadRequest {
  transcriptId: string;
  title: string;
  text: string;
  driveFolderId: string | null;
  driveFolderName: string;
}

type Listener = () => void;

/** Network-style error (lost connection) — eligible for background retry. */
function isNetworkError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    !navigator.onLine ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('load failed') ||
    msg.includes('aborted') ||
    msg.includes('timeout')
  );
}

class Queue {
  jobs: DriveUploadJob[] = [];
  /** When user picks "apply to all" we remember the choice */
  bulkResolution: 'overwrite' | 'duplicate' | 'skip' | null = null;
  private listeners = new Set<Listener>();
  private initialized = false;

  constructor() {
    if (typeof window !== 'undefined') {
      // Retry persisted jobs when network comes back
      window.addEventListener('online', () => { void this.retryPersisted('online'); });
      // Listen for SW background-sync wake-ups
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener?.('message', (ev) => {
          if (ev.data?.type === 'DRIVE_RETRY_PENDING') {
            void this.retryPersisted('sw-sync');
          }
        });
      }
    }
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  clearFinished() {
    this.jobs = this.jobs.filter(
      (j) => j.status !== 'done' && j.status !== 'skipped' && j.status !== 'error'
    );
    this.emit();
  }

  reset() {
    this.jobs = [];
    this.bulkResolution = null;
    this.emit();
  }

  private update(id: string, patch: Partial<DriveUploadJob>) {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
    this.emit();
  }

  /** Restore any pending uploads from previous session (call once on app boot). */
  async restoreFromDb() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      if (!(await isDbAvailable())) return;
      const pending = await db.drivePending.toArray();
      if (pending.length === 0) return;
      for (const p of pending) {
        this.jobs.push({
          id: p.id,
          name: p.name,
          folderId: p.folderId,
          folderName: p.folderName,
          text: p.text,
          status: 'waiting-network',
          resolution: p.resolution,
          error: p.last_error,
          persisted: true,
        });
      }
      this.emit();
      if (navigator.onLine) void this.retryPersisted('boot');
    } catch (e) {
      console.warn('[driveUploadQueue] restoreFromDb failed', e);
    }
  }

  /** Persist a job to IndexedDB so it survives reload / can be retried by SW. */
  private async persist(job: DriveUploadJob, lastError?: string) {
    try {
      if (!(await isDbAvailable())) return;
      const record: PendingDriveUpload = {
        id: job.id,
        name: job.name,
        folderId: job.folderId,
        folderName: job.folderName,
        text: job.text,
        resolution: job.resolution,
        attempts: 0,
        last_error: lastError,
        created_at: Date.now(),
      };
      await db.drivePending.put(record);
      this.update(job.id, { persisted: true });
      // Ask SW to wake us when connectivity returns (no-op in dev/preview)
      this.requestBackgroundSync();
    } catch (e) {
      console.warn('[driveUploadQueue] persist failed', e);
    }
  }

  private async unpersist(id: string) {
    try {
      if (!(await isDbAvailable())) return;
      await db.drivePending.delete(id);
    } catch {
      /* ignore */
    }
  }

  private async requestBackgroundSync() {
    try {
      if (!('serviceWorker' in navigator)) return;
      const reg: any = await navigator.serviceWorker.ready;
      if (reg?.sync?.register) {
        await reg.sync.register('drive-upload-retry').catch(() => {});
      }
    } catch {
      /* ignore — SW unavailable (dev/preview) */
    }
  }

  /** Retry all jobs currently in waiting-network state. */
  private retrying = false;
  async retryPersisted(_source: string) {
    if (this.retrying) return;
    this.retrying = true;
    try {
      const targets = this.jobs.filter((j) => j.status === 'waiting-network' || j.status === 'error');
      for (const job of targets) {
        if (!navigator.onLine) break;
        this.update(job.id, { status: 'pending' });
        await this.processOne(job.id);
      }
    } finally {
      this.retrying = false;
    }
  }

  /** Add and start processing requests. */
  async enqueue(reqs: UploadRequest[]) {
    const newJobs: DriveUploadJob[] = reqs.map((r) => ({
      id: crypto.randomUUID(),
      name: `${(r.title || 'תמלול').replace(/[\\/:*?"<>|]/g, '_')}.txt`,
      folderId: r.driveFolderId,
      folderName: r.driveFolderName,
      text: r.text || '',
      status: 'pending',
    }));
    this.jobs = [...this.jobs, ...newJobs];
    this.emit();
    for (const job of newJobs) {
      // Sequential to avoid hammering the gateway
      await this.processOne(job.id);
    }
  }

  private async processOne(jobId: string) {
    const get = () => this.jobs.find((j) => j.id === jobId);
    let job = get();
    if (!job) return;

    try {
      this.update(jobId, { status: 'checking', error: undefined });
      // Check existing
      const { data, error } = await supabase.functions.invoke('google-drive', {
        body: { action: 'findByName', name: job.name, parentId: job.folderId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const existing = (data?.files || []) as { id: string; name: string; modifiedTime?: string }[];

      if (existing.length > 0) {
        // Need a resolution
        if (this.bulkResolution) {
          this.update(jobId, { existing, resolution: this.bulkResolution });
        } else if (!job.resolution) {
          this.update(jobId, { existing, status: 'awaiting-confirm' });
          // Wait for resolution
          await this.waitForResolution(jobId);
        } else {
          this.update(jobId, { existing });
        }
      }

      job = get();
      if (!job) return;
      if (job.resolution === 'skip') {
        this.update(jobId, { status: 'skipped' });
        await this.unpersist(jobId);
        return;
      }

      this.update(jobId, { status: 'uploading' });
      const base64 = btoa(unescape(encodeURIComponent(job.text)));

      let result;
      if (job.resolution === 'overwrite' && job.existing && job.existing.length > 0) {
        const fileId = job.existing[0].id;
        const res = await supabase.functions.invoke('google-drive', {
          body: { action: 'updateContent', fileId, mimeType: 'text/plain', base64 },
        });
        if (res.error) throw res.error;
        if (res.data?.error) throw new Error(res.data.error);
        result = res.data;
      } else {
        // duplicate OR no existing => create new (Drive allows same name)
        const res = await supabase.functions.invoke('google-drive', {
          body: {
            action: 'upload',
            name: job.name,
            mimeType: 'text/plain',
            base64,
            parents: job.folderId ? [job.folderId] : undefined,
          },
        });
        if (res.error) throw res.error;
        if (res.data?.error) throw new Error(res.data.error);
        result = res.data;
      }

      this.update(jobId, { status: 'done', webViewLink: result?.webViewLink });
      await this.unpersist(jobId);
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (isNetworkError(e)) {
        this.update(jobId, { status: 'waiting-network', error: msg });
        const current = get();
        if (current) await this.persist(current, msg);
      } else {
        this.update(jobId, { status: 'error', error: msg });
      }
    }
  }

  private waitForResolution(jobId: string): Promise<void> {
    return new Promise((resolve) => {
      const unsub = this.subscribe(() => {
        const j = this.jobs.find((x) => x.id === jobId);
        if (!j) { unsub(); resolve(); return; }
        if (j.resolution || j.status === 'skipped' || j.status === 'error') {
          unsub();
          resolve();
        }
      });
    });
  }

  resolve(jobId: string, resolution: 'overwrite' | 'duplicate' | 'skip', applyToAll = false) {
    if (applyToAll) this.bulkResolution = resolution;
    this.update(jobId, { resolution, status: resolution === 'skip' ? 'skipped' : 'uploading' });
    // If bulk, also auto-resolve other awaiting jobs
    if (applyToAll) {
      this.jobs.forEach((j) => {
        if (j.status === 'awaiting-confirm' && !j.resolution) {
          this.update(j.id, { resolution, status: resolution === 'skip' ? 'skipped' : 'uploading' });
        }
      });
    }
  }

  /** Manual retry for a single failed job. */
  async retry(jobId: string) {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return;
    this.update(jobId, { status: 'pending', error: undefined });
    await this.processOne(jobId);
  }
}

export const driveUploadQueue = new Queue();
