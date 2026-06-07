
CREATE TABLE public.youtube_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  url TEXT NOT NULL,
  video_title TEXT,
  thumbnail_url TEXT,
  duration_sec INTEGER,
  mode TEXT NOT NULL DEFAULT 'transcribe',
  status TEXT NOT NULL DEFAULT 'pending',
  progress_pct INTEGER NOT NULL DEFAULT 0,
  backend TEXT,
  output_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  transcript_id UUID,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_youtube_jobs_user_created ON public.youtube_jobs(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.youtube_jobs TO authenticated;
GRANT ALL ON public.youtube_jobs TO service_role;

ALTER TABLE public.youtube_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own youtube jobs"
  ON public.youtube_jobs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER trg_youtube_jobs_updated
  BEFORE UPDATE ON public.youtube_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_user_preferences_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.youtube_jobs;
