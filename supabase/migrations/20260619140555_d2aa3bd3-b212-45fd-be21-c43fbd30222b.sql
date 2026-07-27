CREATE TABLE IF NOT EXISTS public.lora_training_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  job_name TEXT NOT NULL,
  base_model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  dataset_size INTEGER NOT NULL DEFAULT 0,
  epochs INTEGER NOT NULL DEFAULT 3,
  batch_size INTEGER NOT NULL DEFAULT 8,
  learning_rate NUMERIC NOT NULL DEFAULT 0.0001,
  lora_r INTEGER NOT NULL DEFAULT 32,
  lora_alpha INTEGER NOT NULL DEFAULT 64,
  lora_dropout NUMERIC NOT NULL DEFAULT 0.05,
  progress NUMERIC NOT NULL DEFAULT 0,
  current_step INTEGER,
  total_steps INTEGER,
  current_epoch NUMERIC,
  wer_before NUMERIC,
  wer_after NUMERIC,
  cer_before NUMERIC,
  cer_after NUMERIC,
  train_loss NUMERIC,
  eval_loss NUMERIC,
  adapter_path TEXT,
  ct2_model_path TEXT,
  log_tail TEXT,
  error_message TEXT,
  hardware_info JSONB,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lora_training_jobs TO authenticated;
GRANT ALL ON public.lora_training_jobs TO service_role;
ALTER TABLE public.lora_training_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own lora training jobs"
  ON public.lora_training_jobs FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS lora_training_jobs_user_created
  ON public.lora_training_jobs (user_id, created_at DESC);
CREATE TRIGGER trg_lora_training_jobs_updated_at
  BEFORE UPDATE ON public.lora_training_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_asr_learned_corrections_updated_at();