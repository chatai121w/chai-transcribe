-- Add engine preference and source language, repurpose theme for theme_id
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS engine text DEFAULT 'groq',
  ADD COLUMN IF NOT EXISTS source_language text DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS custom_themes jsonb DEFAULT '[]'::jsonb;

-- Rename theme → theme_id for clarity (stores theme id like 'default', 'royal-gold' etc)
-- We keep the column name 'theme' but now store the theme ID string
