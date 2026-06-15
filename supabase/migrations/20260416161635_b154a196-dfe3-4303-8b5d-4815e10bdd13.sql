CREATE TABLE public.text_analysis_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  text_hash text NOT NULL,
  word_count integer NOT NULL DEFAULT 0,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  duplicates jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, text_hash)
);

ALTER TABLE public.text_analysis_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own analysis cache"
  ON public.text_analysis_cache
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_analysis_cache_lookup ON public.text_analysis_cache (user_id, text_hash);