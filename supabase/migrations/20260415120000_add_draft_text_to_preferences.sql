-- Add draft_text column to user_preferences for diarization compare draft persistence
ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS draft_text TEXT DEFAULT NULL;
