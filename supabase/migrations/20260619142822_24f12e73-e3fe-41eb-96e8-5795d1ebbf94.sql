CREATE TABLE public.comparison_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('audio_enhance','transcribe_settings','asr_ground_truth','diarization')),
  recording_fingerprint TEXT NOT NULL,
  recording_label TEXT,
  audio_duration_ms INTEGER,
  engine TEXT,
  model TEXT,
  config_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  hotwords_count INTEGER DEFAULT 0,
  corrections_count INTEGER DEFAULT 0,
  reference_text TEXT,
  hypothesis_text TEXT,
  wer NUMERIC,
  cer NUMERIC,
  term_recall NUMERIC,
  len_ratio NUMERIC,
  elapsed_ms INTEGER,
  user_verdict TEXT CHECK (user_verdict IN ('best','good','bad') OR user_verdict IS NULL),
  notes TEXT,
  source_run_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comparison_runs TO authenticated;
GRANT ALL ON public.comparison_runs TO service_role;

ALTER TABLE public.comparison_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own comparison runs"
  ON public.comparison_runs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_comparison_runs_user_fp_time
  ON public.comparison_runs (user_id, recording_fingerprint, created_at DESC);

CREATE INDEX idx_comparison_runs_user_kind_time
  ON public.comparison_runs (user_id, kind, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_comparison_runs_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER comparison_runs_updated_at
  BEFORE UPDATE ON public.comparison_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_comparison_runs_updated_at();