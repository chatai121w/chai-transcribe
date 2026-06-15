-- Fix function search path by recreating with CASCADE
DROP FUNCTION IF EXISTS public.update_api_keys_updated_at() CASCADE;

CREATE OR REPLACE FUNCTION public.update_api_keys_updated_at()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

-- Recreate the trigger
CREATE TRIGGER update_user_api_keys_updated_at
  BEFORE UPDATE ON public.user_api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.update_api_keys_updated_at();