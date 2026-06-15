
ALTER TABLE public.youtube_jobs
  ADD COLUMN IF NOT EXISTS job_kind text NOT NULL DEFAULT 'youtube',
  ADD COLUMN IF NOT EXISTS stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS current_stage text,
  ADD COLUMN IF NOT EXISTS overall_percent integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resume_token jsonb,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS title text;

CREATE INDEX IF NOT EXISTS idx_youtube_jobs_user_status_created
  ON public.youtube_jobs (user_id, status, created_at DESC);

CREATE POLICY "users read own pipeline artifacts"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'pipeline-artifacts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users upload own pipeline artifacts"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'pipeline-artifacts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users update own pipeline artifacts"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'pipeline-artifacts' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "users delete own pipeline artifacts"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'pipeline-artifacts' AND auth.uid()::text = (storage.foldername(name))[1]);
