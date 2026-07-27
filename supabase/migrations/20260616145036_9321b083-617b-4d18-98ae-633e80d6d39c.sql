GRANT SELECT, INSERT, UPDATE, DELETE ON public.transcript_versions TO authenticated;
GRANT ALL ON public.transcript_versions TO service_role;

DROP POLICY IF EXISTS "Users can update own versions" ON public.transcript_versions;
CREATE POLICY "Users can update own versions"
  ON public.transcript_versions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);