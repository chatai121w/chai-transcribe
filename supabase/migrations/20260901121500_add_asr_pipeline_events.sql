CREATE TABLE IF NOT EXISTS public.asr_pipeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  experiment_id uuid NOT NULL,
  comparison_run_id uuid REFERENCES public.comparison_runs(id) ON DELETE SET NULL,
  recording_fingerprint text,
  stage text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  event_type text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asr_pipeline_events_level_check CHECK (level IN ('info', 'success', 'warning', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_asr_pipeline_events_user_experiment_time
  ON public.asr_pipeline_events (user_id, experiment_id, created_at);

CREATE INDEX IF NOT EXISTS idx_asr_pipeline_events_user_recording_time
  ON public.asr_pipeline_events (user_id, recording_fingerprint, created_at DESC);

ALTER TABLE public.asr_pipeline_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ASR pipeline events" ON public.asr_pipeline_events;
CREATE POLICY "Users can view own ASR pipeline events"
  ON public.asr_pipeline_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own ASR pipeline events" ON public.asr_pipeline_events;
CREATE POLICY "Users can insert own ASR pipeline events"
  ON public.asr_pipeline_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own ASR pipeline events" ON public.asr_pipeline_events;
CREATE POLICY "Users can delete own ASR pipeline events"
  ON public.asr_pipeline_events FOR DELETE
  USING (auth.uid() = user_id);

ALTER TABLE public.asr_pipeline_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'asr_pipeline_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.asr_pipeline_events;
  END IF;
END $$;

