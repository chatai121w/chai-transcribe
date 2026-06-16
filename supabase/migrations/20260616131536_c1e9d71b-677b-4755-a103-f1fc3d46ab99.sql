CREATE TABLE IF NOT EXISTS public.ai_editor_custom_actions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  view_mode TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_editor_custom_actions TO authenticated;
GRANT ALL ON public.ai_editor_custom_actions TO service_role;
ALTER TABLE public.ai_editor_custom_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own ai editor actions" ON public.ai_editor_custom_actions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);