ALTER TABLE public.asr_training_runs
  ADD COLUMN IF NOT EXISTS audio_path TEXT,
  ADD COLUMN IF NOT EXISTS audio_size BIGINT;

-- Storage policies for asr-training/ folder inside permanent-audio
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='asr_training_read_own'
  ) THEN
    CREATE POLICY "asr_training_read_own"
      ON storage.objects FOR SELECT TO authenticated
      USING (
        bucket_id = 'permanent-audio'
        AND (storage.foldername(name))[1] = 'asr-training'
        AND (storage.foldername(name))[2] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='asr_training_insert_own'
  ) THEN
    CREATE POLICY "asr_training_insert_own"
      ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'permanent-audio'
        AND (storage.foldername(name))[1] = 'asr-training'
        AND (storage.foldername(name))[2] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='storage' AND tablename='objects' AND policyname='asr_training_delete_own'
  ) THEN
    CREATE POLICY "asr_training_delete_own"
      ON storage.objects FOR DELETE TO authenticated
      USING (
        bucket_id = 'permanent-audio'
        AND (storage.foldername(name))[1] = 'asr-training'
        AND (storage.foldername(name))[2] = auth.uid()::text
      );
  END IF;
END $$;