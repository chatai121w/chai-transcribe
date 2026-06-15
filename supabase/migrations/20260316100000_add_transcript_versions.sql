-- transcript_versions: stores every text version (original + AI edits + manual)
CREATE TABLE IF NOT EXISTS public.transcript_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID NOT NULL REFERENCES public.transcripts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'original',
  engine_label TEXT,       -- e.g. "Gemini Flash", "GPT-5"
  action_label TEXT,       -- e.g. "שיפור ניסוח", "תיקון דקדוק"
  version_number INT NOT NULL DEFAULT 1,
  word_count INT GENERATED ALWAYS AS (
    array_length(string_to_array(trim(text), ' '), 1)
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_versions_transcript ON public.transcript_versions(transcript_id, version_number);
CREATE INDEX idx_versions_user ON public.transcript_versions(user_id, created_at DESC);

-- RLS
ALTER TABLE public.transcript_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own versions"
  ON public.transcript_versions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own versions"
  ON public.transcript_versions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own versions"
  ON public.transcript_versions FOR DELETE
  USING (auth.uid() = user_id);
