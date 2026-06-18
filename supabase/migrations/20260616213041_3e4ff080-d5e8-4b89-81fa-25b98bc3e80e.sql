ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS design_overrides JSONB DEFAULT '[]'::jsonb;