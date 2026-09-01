CREATE TABLE IF NOT EXISTS public.torah_lexicon_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  canonical_term text NOT NULL,
  normalized_term text NOT NULL,
  variants text[] NOT NULL DEFAULT '{}',
  category text NOT NULL DEFAULT 'other',
  pronunciation text,
  context_tags text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'user',
  approval_status text NOT NULL DEFAULT 'verified',
  confidence double precision NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT torah_lexicon_terms_user_normalized_unique UNIQUE (user_id, normalized_term),
  CONSTRAINT torah_lexicon_terms_status_check CHECK (approval_status IN ('verified', 'candidate', 'rejected')),
  CONSTRAINT torah_lexicon_terms_source_check CHECK (source IN ('user', 'approved-correction', 'import'))
);

CREATE INDEX IF NOT EXISTS idx_torah_lexicon_terms_user_category
  ON public.torah_lexicon_terms (user_id, category, updated_at DESC);

ALTER TABLE public.torah_lexicon_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own Torah lexicon" ON public.torah_lexicon_terms;
CREATE POLICY "Users can view own Torah lexicon"
  ON public.torah_lexicon_terms FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own Torah lexicon" ON public.torah_lexicon_terms;
CREATE POLICY "Users can insert own Torah lexicon"
  ON public.torah_lexicon_terms FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own Torah lexicon" ON public.torah_lexicon_terms;
CREATE POLICY "Users can update own Torah lexicon"
  ON public.torah_lexicon_terms FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own Torah lexicon" ON public.torah_lexicon_terms;
CREATE POLICY "Users can delete own Torah lexicon"
  ON public.torah_lexicon_terms FOR DELETE
  USING (auth.uid() = user_id);

ALTER TABLE public.torah_lexicon_terms REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'torah_lexicon_terms'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.torah_lexicon_terms;
  END IF;
END $$;

