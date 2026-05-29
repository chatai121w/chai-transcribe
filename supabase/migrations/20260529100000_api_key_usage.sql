-- Per-API-key usage tracking (events log + aggregated stats)
-- Stores one row per successful transcription with provider, key fingerprint, seconds, words.
-- Aggregation done on the client (last 24h + all-time peak per key).

CREATE TABLE IF NOT EXISTS public.api_key_usage_events (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider     text NOT NULL,                  -- 'groq' | 'openai' | ...
  key_fp       text NOT NULL,                  -- fingerprint: first4 + '...' + last4
  seconds      double precision NOT NULL DEFAULT 0,
  words        integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_key_usage_events_user_provider_time_idx
  ON public.api_key_usage_events (user_id, provider, created_at DESC);

ALTER TABLE public.api_key_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own usage" ON public.api_key_usage_events;
CREATE POLICY "users can read own usage"
  ON public.api_key_usage_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "users can insert own usage" ON public.api_key_usage_events;
CREATE POLICY "users can insert own usage"
  ON public.api_key_usage_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "users can delete own usage" ON public.api_key_usage_events;
CREATE POLICY "users can delete own usage"
  ON public.api_key_usage_events FOR DELETE
  USING (auth.uid() = user_id);
