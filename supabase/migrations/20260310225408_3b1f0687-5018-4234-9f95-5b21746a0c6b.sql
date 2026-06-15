
-- Create transcription jobs table for background processing
CREATE TABLE public.transcription_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploading', 'processing', 'completed', 'failed')),
  engine TEXT NOT NULL DEFAULT 'groq',
  file_name TEXT,
  file_path TEXT,
  language TEXT DEFAULT 'he',
  result_text TEXT,
  error_message TEXT,
  progress INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.transcription_jobs ENABLE ROW LEVEL SECURITY;

-- Users can only see their own jobs
CREATE POLICY "Users can view own jobs" ON public.transcription_jobs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own jobs" ON public.transcription_jobs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own jobs" ON public.transcription_jobs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own jobs" ON public.transcription_jobs
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Also allow service role (edge functions) to update jobs
-- Service role bypasses RLS by default, so no extra policy needed

-- Enable realtime for job status updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.transcription_jobs;

-- Create storage bucket for audio files
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('audio-files', 'audio-files', false, 52428800)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: users can upload to their own folder
CREATE POLICY "Users can upload audio files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'audio-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can read own audio files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'audio-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete own audio files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'audio-files' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Service role can access all files (for edge functions)
CREATE POLICY "Service role full access" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'audio-files');
