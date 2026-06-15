
CREATE TABLE public.diarization_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  transcript_id UUID REFERENCES public.transcripts(id) ON DELETE CASCADE,
  file_name TEXT,
  segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  speakers JSONB NOT NULL DEFAULT '[]'::jsonb,
  speaker_names JSONB NOT NULL DEFAULT '{}'::jsonb,
  speaker_count INTEGER NOT NULL DEFAULT 0,
  duration NUMERIC NOT NULL DEFAULT 0,
  processing_time NUMERIC,
  diarization_method TEXT,
  engine TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.diarization_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own diarization results"
  ON public.diarization_results
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
