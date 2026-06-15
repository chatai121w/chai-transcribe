-- Add CUDA/transcription preference columns to user_preferences
-- These sync transcription engine settings across devices

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS cuda_preset text DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS cuda_fast_mode boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS cuda_compute_type text DEFAULT 'int8_float16',
  ADD COLUMN IF NOT EXISTS cuda_beam_size integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cuda_no_condition_prev boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS cuda_vad_aggressive boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cuda_hotwords text DEFAULT '',
  ADD COLUMN IF NOT EXISTS cuda_paragraph_threshold real DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cuda_preload_mode text DEFAULT 'preload',
  ADD COLUMN IF NOT EXISTS cuda_cloud_save text DEFAULT 'immediate';
