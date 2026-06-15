-- Create admin-only SQL execution function
CREATE OR REPLACE FUNCTION public.execute_sql_admin(sql_text text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  EXECUTE sql_text;
  result := json_build_object('success', true);
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

-- Only service role can call this (edge function uses service role key)
REVOKE ALL ON FUNCTION public.execute_sql_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_sql_admin(text) FROM anon;
REVOKE ALL ON FUNCTION public.execute_sql_admin(text) FROM authenticated;