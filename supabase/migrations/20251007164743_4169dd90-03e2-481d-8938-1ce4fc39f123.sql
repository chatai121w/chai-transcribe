-- Add new API key columns for AssemblyAI and Deepgram
ALTER TABLE public.user_api_keys 
ADD COLUMN IF NOT EXISTS assemblyai_key TEXT,
ADD COLUMN IF NOT EXISTS deepgram_key TEXT;