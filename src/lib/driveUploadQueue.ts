import { supabase } from '@/integrations/supabase/client';

export type DriveUploadStatus =
  | 'pending'
  | 'checking'
  | 'awaiting-confirm'
  | 'uploading'
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
}

export interface UploadRequest {
  transcriptId: string;
  title: string;
  text: string;
  driveFolderId: string | null;
  driveFolderName: string;
}

type Listener = () => void;

class Queue {
  jobs: DriveUploadJob[] = [];
  /** When user picks "apply to all" we remember the choice */
  bulkResolution: 'overwrite' | 'duplicate' | 'skip' | null = null;
  private listeners = new Set<Listener>();

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
      this.update(jobId, { status: 'checking' });
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
        } else {
          this.update(jobId, { existing, status: 'awaiting-confirm' });
          // Wait for resolution
          await this.waitForResolution(jobId);
        }
      }

      job = get();
      if (!job) return;
      if (job.resolution === 'skip') {
        this.update(jobId, { status: 'skipped' });
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
    } catch (e: any) {
      this.update(jobId, { status: 'error', error: e?.message || String(e) });
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
}

export const driveUploadQueue = new Queue();
