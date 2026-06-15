ALTER TABLE public.transcription_jobs 
ADD COLUMN IF NOT EXISTS partial_result text DEFAULT '',
ADD COLUMN IF NOT EXISTS total_chunks integer DEFAULT 1,
ADD COLUMN IF NOT EXISTS completed_chunks integer DEFAULT 0;