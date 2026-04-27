-- Enable cross-device theme sync via Supabase Realtime
-- 1) Ensure updated_at column exists with auto-refresh trigger
-- 2) Enable realtime publication so cross-device sync works

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Auto-update updated_at on every UPDATE
CREATE OR REPLACE FUNCTION public.set_user_preferences_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_preferences_set_updated_at ON public.user_preferences;
CREATE TRIGGER user_preferences_set_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_preferences_updated_at();

-- Realtime needs full row replica identity to deliver UPDATE payloads
ALTER TABLE public.user_preferences REPLICA IDENTITY FULL;

-- Add to realtime publication if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_preferences'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_preferences;
  END IF;
END $$;
