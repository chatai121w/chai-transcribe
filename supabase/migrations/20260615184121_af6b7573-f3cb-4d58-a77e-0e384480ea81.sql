ALTER TABLE public.ai_usage_events
  ADD COLUMN IF NOT EXISTS prompt_preview TEXT,
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS response_preview TEXT,
  ADD COLUMN IF NOT EXISTS params JSONB,
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER,
  ADD COLUMN IF NOT EXISTS cost_usd_snapshot NUMERIC(12,6);

CREATE INDEX IF NOT EXISTS ai_usage_events_user_created_idx
  ON public.ai_usage_events (user_id, created_at DESC);