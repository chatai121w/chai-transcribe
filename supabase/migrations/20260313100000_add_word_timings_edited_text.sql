-- Add word_timings (JSONB) and edited_text columns to transcripts table
-- word_timings stores the sync data for the audio player [{word, start, end, probability?}, ...]
-- edited_text stores the user-edited version, preserving the original in `text`
ALTER TABLE public.transcripts
  ADD COLUMN IF NOT EXISTS word_timings JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS edited_text TEXT DEFAULT NULL;
