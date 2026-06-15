-- Store diarization compare UI preferences in a dedicated cloud column
ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS compare_settings_json JSONB DEFAULT NULL;