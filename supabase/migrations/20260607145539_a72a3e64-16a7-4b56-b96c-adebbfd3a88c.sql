
CREATE POLICY "yt outputs read own"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'youtube-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "yt outputs insert own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'youtube-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "yt outputs update own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'youtube-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "yt outputs delete own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'youtube-outputs' AND auth.uid()::text = (storage.foldername(name))[1]);
