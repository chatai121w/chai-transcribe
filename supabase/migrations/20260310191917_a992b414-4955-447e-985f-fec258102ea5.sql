-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Users can manage their own API keys" ON public.user_api_keys;

-- Create proper RLS policy tied to auth user
CREATE POLICY "Users can manage their own API keys"
ON public.user_api_keys FOR ALL TO authenticated
USING (user_identifier = auth.uid()::text)
WITH CHECK (user_identifier = auth.uid()::text);