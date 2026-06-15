-- Add editor_columns preference for multi-column text display
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS editor_columns integer DEFAULT 1;
