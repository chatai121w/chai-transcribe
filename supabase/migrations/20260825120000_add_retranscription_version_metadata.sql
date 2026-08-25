ALTER TABLE public.transcript_versions
  ADD COLUMN IF NOT EXISTS word_timings jsonb,
  ADD COLUMN IF NOT EXISTS detected_language text,
  ADD COLUMN IF NOT EXISTS transcription_job_id uuid REFERENCES public.transcription_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transcript_versions_transcription_job
  ON public.transcript_versions (transcription_job_id)
  WHERE transcription_job_id IS NOT NULL;
