ALTER TABLE public.user_preferences
ADD COLUMN IF NOT EXISTS lk_rules JSONB DEFAULT NULL;

COMMENT ON COLUMN public.user_preferences.lk_rules IS 'Loshon Kodesh rules: prompt, hotwords, replacements, names, profileId, postProcess, aiPolish';