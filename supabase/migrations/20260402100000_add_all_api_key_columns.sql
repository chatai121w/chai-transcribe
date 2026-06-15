-- Add missing API key columns to user_api_keys table
-- This covers all keys that were previously only stored in localStorage

-- Server configuration keys
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS whisper_server_url TEXT DEFAULT NULL;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS whisper_api_key TEXT DEFAULT NULL;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS ollama_base_url TEXT DEFAULT NULL;

-- Key pools (JSON arrays of multiple keys for rotation)
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS openai_keys_pool JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS google_keys_pool JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS groq_keys_pool JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS assemblyai_keys_pool JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS deepgram_keys_pool JSONB DEFAULT '[]'::jsonb;
