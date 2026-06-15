import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface DiarizationJob {
  id: string;
  status: string;
  engine: string;
  file_name: string | null;
  file_path: string | null;
  progress: number;
  result: any;
  error_message: string | null;
  speaker_roles: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export function useDiarizationJobs() {
  const [jobs, setJobs] = useState<DiarizationJob[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadJobs = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setIsLoading(true);
    const { data } = await (supabase as any)
      .from('diarization_jobs')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (data) setJobs(data);
    setIsLoading(false);
  }, []);

  // Subscribe to realtime updates
  useEffect(() => {
    loadJobs();

    const channel = supabase
      .channel('diarization-jobs-updates')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'diarization_jobs',
      }, (payload: any) => {
        if (payload.eventType === 'UPDATE') {
          setJobs(prev => prev.map(j =>
            j.id === payload.new.id ? { ...j, ...payload.new } : j
          ));
          if (payload.new.status === 'completed') {
            toast({ title: '✅ זיהוי דוברים הושלם', description: payload.new.file_name || 'עבודת רקע' });
          } else if (payload.new.status === 'error') {
            toast({ title: '❌ שגיאה בזיהוי דוברים', description: payload.new.error_message || 'שגיאה', variant: 'destructive' });
          }
        } else if (payload.eventType === 'INSERT') {
          setJobs(prev => [payload.new, ...prev]);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loadJobs]);

  const startBackgroundJob = useCallback(async (file: File, engine: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast({ title: 'יש להתחבר', variant: 'destructive' });
      return null;
    }

    // Upload file to storage
    const filePath = `diarization/${user.id}/${Date.now()}-${file.name}`;
    const { error: uploadErr } = await supabase.storage.from('audio-files').upload(filePath, file);
    if (uploadErr) {
      toast({ title: 'שגיאה בהעלאת קובץ', description: uploadErr.message, variant: 'destructive' });
      return null;
    }

    // Create job record
    const { data: job, error: jobErr } = await (supabase as any)
      .from('diarization_jobs')
      .insert({
        user_id: user.id,
        engine,
        file_name: file.name,
        file_path: filePath,
        status: 'pending',
        progress: 0,
      })
      .select()
      .single();

    if (jobErr || !job) {
      toast({ title: 'שגיאה ביצירת עבודה', description: jobErr?.message, variant: 'destructive' });
      return null;
    }

    // Trigger edge function (fire-and-forget)
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    fetch(`https://${projectId}.supabase.co/functions/v1/diarize-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({ jobId: job.id }),
    }).catch(err => console.error('Failed to trigger diarize-background:', err));

    toast({ title: '🚀 זיהוי דוברים ברקע', description: `${file.name} — ${engine}` });
    return job;
  }, []);

  const retryJob = useCallback(async (jobId: string) => {
    // Reset job status and re-trigger
    await (supabase as any)
      .from('diarization_jobs')
      .update({ status: 'pending', progress: 0, error_message: null, updated_at: new Date().toISOString() })
      .eq('id', jobId);

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    fetch(`https://${projectId}.supabase.co/functions/v1/diarize-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
      },
      body: JSON.stringify({ jobId }),
    }).catch(err => console.error('Failed to retry diarize-background:', err));

    toast({ title: '🔄 מנסה שוב', description: 'ממשיך מנקודת העצירה' });
  }, []);

  const updateSpeakerRoles = useCallback(async (jobId: string, roles: Record<string, string>) => {
    await (supabase as any)
      .from('diarization_jobs')
      .update({ speaker_roles: roles, updated_at: new Date().toISOString() })
      .eq('id', jobId);
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, speaker_roles: roles } : j));
  }, []);

  return { jobs, isLoading, loadJobs, startBackgroundJob, retryJob, updateSpeakerRoles };
}
