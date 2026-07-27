CREATE TABLE IF NOT EXISTS public.user_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  label TEXT NOT NULL,
  prompt TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'מותאם אישי',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_prompts TO authenticated;
GRANT ALL ON public.user_prompts TO service_role;

ALTER TABLE public.user_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own prompts"
  ON public.user_prompts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_prompts_user_id ON public.user_prompts(user_id);

CREATE TRIGGER update_user_prompts_updated_at
  BEFORE UPDATE ON public.user_prompts
  FOR EACH ROW EXECUTE FUNCTION public.set_user_preferences_updated_at();