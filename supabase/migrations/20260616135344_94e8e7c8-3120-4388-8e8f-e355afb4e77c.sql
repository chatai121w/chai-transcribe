
ALTER TABLE public.transcript_versions
  ADD COLUMN IF NOT EXISTS ai_usage_event_id uuid REFERENCES public.ai_usage_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audio_file_path text;

CREATE INDEX IF NOT EXISTS idx_versions_transcript_created
  ON public.transcript_versions (transcript_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_versions_folder
  ON public.transcript_versions (folder_id)
  WHERE folder_id IS NOT NULL;
