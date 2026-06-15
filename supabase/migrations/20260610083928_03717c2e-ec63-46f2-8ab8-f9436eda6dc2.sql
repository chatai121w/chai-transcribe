-- Community themes: themes published by admin, visible to all authenticated users.
CREATE TABLE IF NOT EXISTS public.community_themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  name_he text NOT NULL,
  colors jsonb NOT NULL,
  style jsonb,
  element_overrides jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.community_themes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_themes TO authenticated;
GRANT ALL ON public.community_themes TO service_role;

ALTER TABLE public.community_themes ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read community themes.
CREATE POLICY "Anyone authenticated can read community themes"
ON public.community_themes
FOR SELECT TO authenticated
USING (true);

-- Only admin role can insert/update/delete.
CREATE POLICY "Admins can insert community themes"
ON public.community_themes
FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update community themes"
ON public.community_themes
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete community themes"
ON public.community_themes
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER set_community_themes_updated_at
BEFORE UPDATE ON public.community_themes
FOR EACH ROW EXECUTE FUNCTION public.set_user_preferences_updated_at();
