-- Canonical learned-correction identity: one table, explicit global/profile scope.
-- Existing rows remain global. Legacy localStorage keys are preserved by the
-- client migration as rollback data and are not represented as duplicate rows.

ALTER TABLE public.asr_learned_corrections
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN IF NOT EXISTS profile_id TEXT NOT NULL DEFAULT '';

UPDATE public.asr_learned_corrections
SET scope = 'global'
WHERE scope IS NULL OR scope NOT IN ('global', 'profile');

UPDATE public.asr_learned_corrections
SET profile_id = ''
WHERE profile_id IS NULL OR scope = 'global';

ALTER TABLE public.asr_learned_corrections
  DROP CONSTRAINT IF EXISTS asr_learned_corrections_user_pair_unique;

ALTER TABLE public.asr_learned_corrections
  DROP CONSTRAINT IF EXISTS asr_learned_corrections_scope_check;

ALTER TABLE public.asr_learned_corrections
  ADD CONSTRAINT asr_learned_corrections_scope_check
  CHECK (
    (scope = 'global' AND profile_id = '') OR
    (scope = 'profile' AND length(profile_id) > 0)
  );

ALTER TABLE public.asr_learned_corrections
  DROP CONSTRAINT IF EXISTS asr_learned_corrections_scoped_pair_unique;

ALTER TABLE public.asr_learned_corrections
  ADD CONSTRAINT asr_learned_corrections_scoped_pair_unique
  UNIQUE (user_id, scope, profile_id, original, corrected);

CREATE INDEX IF NOT EXISTS asr_learned_corrections_user_scope_updated_idx
  ON public.asr_learned_corrections (user_id, scope, profile_id, updated_at DESC);
