ALTER TABLE public.transcripts 
  ADD COLUMN IF NOT EXISTS category text DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_favorite boolean DEFAULT false;