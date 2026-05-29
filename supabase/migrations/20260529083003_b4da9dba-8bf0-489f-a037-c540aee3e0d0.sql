ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS personal_pronunciation_enabled boolean;

UPDATE public.user_preferences
SET personal_pronunciation_enabled = true
WHERE personal_pronunciation_enabled IS NULL;

ALTER TABLE public.user_preferences
ALTER COLUMN personal_pronunciation_enabled SET DEFAULT true;

ALTER TABLE public.user_preferences
ALTER COLUMN personal_pronunciation_enabled SET NOT NULL;