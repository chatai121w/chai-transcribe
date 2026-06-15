-- Add audio_file_path column to transcripts table
ALTER TABLE public.transcripts ADD COLUMN IF NOT EXISTS audio_file_path text DEFAULT NULL;

-- Create permanent audio storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('permanent-audio', 'permanent-audio', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: Users can upload their own audio files
CREATE POLICY "Users can upload own audio"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'permanent-audio' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: Users can read their own audio files
CREATE POLICY "Users can read own audio"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'permanent-audio' AND (storage.foldername(name))[1] = auth.uid()::text);

-- RLS: Users can delete their own audio files
CREATE POLICY "Users can delete own audio"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'permanent-audio' AND (storage.foldername(name))[1] = auth.uid()::text);