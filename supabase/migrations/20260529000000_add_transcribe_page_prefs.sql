-- Add transcription-page preferences that were previously localStorage-only
-- loshon_kodesh_enabled: Loshon Kodesh / Ashkenazic pronunciation mode
-- active_pronunciation_profile: the active named pronunciation profile ID
-- diarize_enabled: speaker diarization toggle

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS loshon_kodesh_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active_pronunciation_profile text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS diarize_enabled boolean NOT NULL DEFAULT false;
