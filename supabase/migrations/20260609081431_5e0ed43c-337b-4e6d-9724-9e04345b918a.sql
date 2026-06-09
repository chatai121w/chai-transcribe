ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS live_chunk_sec integer DEFAULT 5,
  ADD COLUMN IF NOT EXISTS live_mic_gain real DEFAULT 3.5;