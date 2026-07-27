CREATE TABLE public.asr_learned_corrections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  original TEXT NOT NULL,
  corrected TEXT NOT NULL,
  note TEXT,
  frequency INTEGER NOT NULL DEFAULT 1,
  confidence REAL NOT NULL DEFAULT 0.5,
  engine TEXT NOT NULL DEFAULT 'manual',
  category TEXT NOT NULL DEFAULT 'word',
  last_used TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT asr_learned_corrections_user_pair_unique UNIQUE (user_id, original, corrected)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asr_learned_corrections TO authenticated;
GRANT ALL ON public.asr_learned_corrections TO service_role;

ALTER TABLE public.asr_learned_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own learned corrections"
  ON public.asr_learned_corrections
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX asr_learned_corrections_user_updated_idx
  ON public.asr_learned_corrections (user_id, updated_at DESC);

CREATE OR REPLACE FUNCTION public.set_asr_learned_corrections_updated_at()
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

CREATE TRIGGER asr_learned_corrections_set_updated_at
  BEFORE UPDATE ON public.asr_learned_corrections
  FOR EACH ROW EXECUTE FUNCTION public.set_asr_learned_corrections_updated_at();