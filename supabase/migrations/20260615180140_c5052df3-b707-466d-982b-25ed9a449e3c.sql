
CREATE TABLE public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_usage_user_created ON public.ai_usage_events(user_id, created_at DESC);
CREATE INDEX idx_ai_usage_user_feature ON public.ai_usage_events(user_id, feature, created_at DESC);

GRANT SELECT, INSERT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own AI usage"
  ON public.ai_usage_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own AI usage"
  ON public.ai_usage_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);
