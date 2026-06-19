CREATE TABLE public.asr_training_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  source_kind TEXT NOT NULL,
  source_ref TEXT,
  source_label TEXT,
  ref_text TEXT NOT NULL,
  hyp_a_text TEXT,
  hyp_b_text TEXT,
  model_a TEXT,
  model_b TEXT,
  wer_a NUMERIC,
  cer_a NUMERIC,
  term_recall_a NUMERIC,
  wer_b NUMERIC,
  cer_b NUMERIC,
  term_recall_b NUMERIC,
  audio_duration_ms INTEGER,
  audio_filename TEXT,
  learning_mode TEXT NOT NULL DEFAULT 'hybrid',
  corrections_applied INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asr_training_runs TO authenticated;
GRANT ALL ON public.asr_training_runs TO service_role;
ALTER TABLE public.asr_training_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own training runs"
  ON public.asr_training_runs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX asr_training_runs_user_created_idx
  ON public.asr_training_runs(user_id, created_at DESC);

CREATE TABLE public.asr_pending_corrections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  run_id UUID REFERENCES public.asr_training_runs(id) ON DELETE CASCADE,
  wrong_text TEXT NOT NULL,
  correct_text TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  engine TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asr_pending_corrections TO authenticated;
GRANT ALL ON public.asr_pending_corrections TO service_role;
ALTER TABLE public.asr_pending_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own pending corrections"
  ON public.asr_pending_corrections FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX asr_pending_corrections_user_status_idx
  ON public.asr_pending_corrections(user_id, status, created_at DESC);

CREATE UNIQUE INDEX asr_pending_corrections_unique_pair
  ON public.asr_pending_corrections(user_id, wrong_text, correct_text)
  WHERE status = 'pending';