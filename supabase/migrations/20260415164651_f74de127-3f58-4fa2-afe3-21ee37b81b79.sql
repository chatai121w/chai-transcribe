
CREATE TABLE public.conversion_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  output_format TEXT NOT NULL DEFAULT 'mp3',
  file_size BIGINT DEFAULT 0,
  output_size BIGINT DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  folder TEXT DEFAULT '',
  file_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.conversion_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own conversion history"
ON public.conversion_history
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
