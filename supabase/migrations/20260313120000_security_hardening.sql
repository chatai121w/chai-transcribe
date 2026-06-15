-- Security hardening: revoke public access to dangerous SQL execution functions
REVOKE ALL ON FUNCTION public.exec_sql_return(text) FROM public;
REVOKE ALL ON FUNCTION public.exec_sql_return(text) FROM anon;
REVOKE ALL ON FUNCTION public.exec_sql_return(text) FROM authenticated;

-- Add missing performance indexes
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_user_id ON public.transcription_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_transcription_jobs_status ON public.transcription_jobs(status);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON public.user_preferences(user_id);
