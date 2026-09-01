CREATE OR REPLACE FUNCTION public.normalize_torah_lexicon_term(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT lower(
    regexp_replace(
      regexp_replace(trim(value), '[׳״"'']', '', 'g'),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.set_torah_lexicon_normalized_term()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.normalized_term := public.normalize_torah_lexicon_term(NEW.canonical_term);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_torah_lexicon_normalized_term ON public.torah_lexicon_terms;
CREATE TRIGGER trg_set_torah_lexicon_normalized_term
  BEFORE INSERT OR UPDATE OF canonical_term, normalized_term
  ON public.torah_lexicon_terms
  FOR EACH ROW
  EXECUTE FUNCTION public.set_torah_lexicon_normalized_term();

UPDATE public.torah_lexicon_terms
SET normalized_term = public.normalize_torah_lexicon_term(canonical_term)
WHERE normalized_term IS DISTINCT FROM public.normalize_torah_lexicon_term(canonical_term);

ALTER TABLE public.torah_lexicon_terms
  DROP CONSTRAINT IF EXISTS torah_lexicon_terms_normalized_matches_canonical;
ALTER TABLE public.torah_lexicon_terms
  ADD CONSTRAINT torah_lexicon_terms_normalized_matches_canonical
  CHECK (normalized_term = public.normalize_torah_lexicon_term(canonical_term));
