
-- Create diarization_jobs table for background processing
CREATE TABLE public.diarization_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  engine TEXT NOT NULL DEFAULT 'assemblyai',
  file_name TEXT,
  file_path TEXT,
  language TEXT DEFAULT 'he',
  progress INTEGER DEFAULT 0,
  result JSONB,
  error_message TEXT,
  external_job_id TEXT,
  resume_data JSONB DEFAULT '{}'::jsonb,
  speaker_roles JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.diarization_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own diarization jobs"
  ON public.diarization_jobs
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.diarization_jobs;
