import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { splitFileIntoChunks } from '@/utils/audioChunker';
import { debugLog } from '@/lib/debugLogger';

export interface TranscriptionJob {
  id: string;
  user_id: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
  engine: string;
  file_name: string | null;
  file_path: string | null;
  language: string | null;
  result_text: string | null;
  error_message: string | null;
  progress: number;
  created_at: string;
  updated_at: string;
  partial_result: string | null;
  total_chunks: number | null;
  completed_chunks: number | null;
}

const MAX_CONCURRENT_JOBS = 3;

export const useTranscriptionJobs = () => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<TranscriptionJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const deletedIdsRef = useRef<Set<string>>(new Set());

  const loadJobs = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('transcription_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      setJobs((data as TranscriptionJob[]) || []);
    } catch (err) {
      debugLog.error('Jobs', 'Error loading jobs', err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`transcription-jobs-${user.id}-${Math.random().toString(36).slice(2, 10)}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'transcription_jobs',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const newJob = payload.new as TranscriptionJob;
          if (!deletedIdsRef.current.has(newJob.id)) {
            setJobs(prev => [newJob, ...prev]);
          }
        } else if (payload.eventType === 'UPDATE') {
          const updated = payload.new as TranscriptionJob;
          // Skip updates for jobs the user already deleted locally
          if (deletedIdsRef.current.has(updated.id)) return;
          setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
          if (updated.status === 'completed') {
            toast({ title: "תמלול הושלם! ✅", description: `הקובץ "${updated.file_name}" תומלל בהצלחה` });
            // Send push notification if page is not focused
            if (document.hidden && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({
                type: 'SHOW_NOTIFICATION',
                title: 'תמלול הושלם! ✅',
                body: `הקובץ "${updated.file_name}" תומלל בהצלחה`,
                tag: `job-${updated.id}`,
                url: '/transcribe',
              });
            }
          } else if (updated.status === 'failed') {
            toast({ title: "שגיאה בתמלול", description: updated.error_message || 'שגיאה לא ידועה', variant: "destructive" });
            if (document.hidden && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({
                type: 'SHOW_NOTIFICATION',
                title: 'שגיאה בתמלול ❌',
                body: `${updated.file_name}: ${updated.error_message || 'שגיאה לא ידועה'}`,
                tag: `job-${updated.id}`,
                url: '/transcribe',
              });
            }
          }
        } else if (payload.eventType === 'DELETE') {
          setJobs(prev => prev.filter(j => j.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const triggerProcessing = (jobId: string) => {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-transcription`;
    fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobId }),
    }).catch(err => debugLog.error('Jobs', 'Error triggering processing', err instanceof Error ? err.message : String(err)));
  };

  // Submit a single job (with chunking for large files)
  const submitJob = useCallback(async (
    file: File, engine: string, language: string
  ): Promise<string | null> => {
    if (!user) {
      toast({ title: "נדרשת התחברות", description: "יש להתחבר כדי להשתמש בתמלול ברקע", variant: "destructive" });
      return null;
    }

    if (engine === 'local' || engine === 'local-server') {
      toast({ title: "מנוע מקומי", description: "מנועים מקומיים לא נתמכים בתמלול ברקע. בחר מנוע אונליין.", variant: "destructive" });
      return null;
    }

    try {
      const chunks = splitFileIntoChunks(file);

      const { data: job, error: jobError } = await supabase
        .from('transcription_jobs')
        .insert({
          user_id: user.id,
          status: 'uploading' as string,
          engine,
          file_name: file.name,
          language,
          progress: 0,
          total_chunks: chunks.length,
          completed_chunks: 0,
          partial_result: '',
        })
        .select()
        .single();

      if (jobError || !job) throw new Error('Failed to create job');

      toast({ title: "מעלה קובץ ברקע...", description: `"${file.name}" - ${chunks.length > 1 ? `${chunks.length} חלקים` : 'חלק אחד'}` });

      // Request notification permission (non-blocking) for background job alerts
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }

      // Upload file to storage
      const filePath = `${user.id}/${job.id}_${Date.now()}.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage
        .from('audio-files')
        .upload(filePath, file);

      if (uploadError) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        const msg = /exceeded|too large|maximum/i.test(uploadError.message)
          ? `הקובץ גדול מדי להעלאה (${sizeMB}MB). מומלץ להמיר ל-MP3/Opus לפני התמלול.`
          : `שגיאה בהעלאת הקובץ: ${uploadError.message}`;
        await supabase.from('transcription_jobs')
          .update({ status: 'failed', error_message: msg })
          .eq('id', job.id);
        throw new Error(msg);
      }

      await supabase.from('transcription_jobs')
        .update({ file_path: filePath, status: 'pending', progress: 20 })
        .eq('id', job.id);

      triggerProcessing(job.id);
      return job.id;
    } catch (error) {
      debugLog.error('Jobs', 'Error submitting job', error instanceof Error ? error.message : String(error));
      toast({ title: "שגיאה", description: error instanceof Error ? error.message : "שגיאה בשליחת העבודה", variant: "destructive" });
      return null;
    }
  }, [user]);

  // Submit multiple jobs with concurrency limit
  const submitBatchJobs = useCallback(async (
    files: File[], engine: string, language: string
  ): Promise<string[]> => {
    if (!user) {
      toast({ title: "נדרשת התחברות", variant: "destructive" });
      return [];
    }

    const ids: string[] = [];
    const concurrency = Math.min(MAX_CONCURRENT_JOBS, files.length);
    // Pre-assign files to workers to avoid race on shared index
    const buckets: File[][] = Array.from({ length: concurrency }, () => []);
    files.forEach((f, i) => buckets[i % concurrency].push(f));

    const workers = buckets.map(bucket => (async () => {
      for (const file of bucket) {
        const id = await submitJob(file, engine, language);
        if (id) ids.push(id);
      }
    })());
    await Promise.all(workers);

    toast({ title: `${ids.length} עבודות נשלחו לתמלול ברקע` });
    return ids;
  }, [user, submitJob]);

  const retryJob = useCallback(async (jobId: string) => {
    try {
      const job = jobs.find(j => j.id === jobId);
      // Resume from partial - keep completed_chunks and partial_result
      const updates: Record<string, unknown> = {
        status: 'pending',
        error_message: null,
        progress: 20,
      };

      // If no partial progress, reset
      if (!job?.completed_chunks || job.completed_chunks === 0) {
        updates.completed_chunks = 0;
        updates.partial_result = '';
      }

      await supabase.from('transcription_jobs')
        .update(updates)
        .eq('id', jobId);

      triggerProcessing(jobId);
      toast({ title: "ניסיון חוזר...", description: job?.completed_chunks ? `ממשיך מחלק ${job.completed_chunks}` : "שולח מחדש" });
    } catch (err) {
      debugLog.error('Jobs', 'Error retrying job', err instanceof Error ? err.message : String(err));
    }
  }, [jobs]);

  const deleteJob = useCallback(async (jobId: string) => {
    // Mark as deleted to prevent realtime re-adding
    deletedIdsRef.current.add(jobId);

    // Optimistic: remove from UI immediately
    let removedJob: TranscriptionJob | undefined;
    setJobs(prev => {
      removedJob = prev.find(j => j.id === jobId);
      return prev.filter(j => j.id !== jobId);
    });

    try {
      // Delete DB record first (most important)
      const { error } = await supabase.from('transcription_jobs').delete().eq('id', jobId);
      if (error) throw error;

      // Then try to delete storage file (non-blocking)
      if (removedJob?.file_path) {
        supabase.storage.from('audio-files').remove([removedJob.file_path]).catch(() => {});
      }
      toast({ title: "נמחק ✓", description: removedJob?.file_name || 'העבודה נמחקה' });
    } catch (err) {
      debugLog.error('Jobs', 'Error deleting job', err instanceof Error ? err.message : String(err));
      // Rollback: restore the job in UI
      deletedIdsRef.current.delete(jobId);
      if (removedJob) {
        setJobs(prev => [removedJob!, ...prev]);
      }
      toast({ title: "שגיאה במחיקה", description: err instanceof Error ? err.message : 'לא ניתן למחוק', variant: "destructive" });
    }
  }, []);

  const activeJobs = jobs.filter(j => ['pending', 'uploading', 'processing'].includes(j.status));
  const completedJobs = jobs.filter(j => j.status === 'completed');
  const failedJobs = jobs.filter(j => j.status === 'failed');

  return {
    jobs, activeJobs, completedJobs, failedJobs,
    isLoading, submitJob, submitBatchJobs, retryJob, deleteJob, loadJobs,
  };
};
