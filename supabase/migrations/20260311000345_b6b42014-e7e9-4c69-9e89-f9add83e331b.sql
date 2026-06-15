
CREATE TABLE public.user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  font_size integer DEFAULT 16,
  font_family text DEFAULT 'Assistant',
  text_color text DEFAULT 'hsl(var(--foreground))',
  line_height numeric DEFAULT 1.6,
  sidebar_pinned boolean DEFAULT false,
  theme text DEFAULT 'light',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own preferences"
  ON public.user_preferences FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
