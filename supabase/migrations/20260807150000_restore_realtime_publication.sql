-- ═══════════════════════════════════════════════════════════════════════
-- Restore realtime for the tables the app subscribes to.
--
-- The `supabase_realtime` publication on this project contains zero tables,
-- so every postgres_changes subscription in the app joins successfully and
-- then never receives an event. The UI only ever refreshes on mount, which
-- is why job lists and progress readouts appear frozen mid-run.
--
-- Earlier migrations do run `ALTER PUBLICATION supabase_realtime ADD TABLE`,
-- but the publication is empty on the live database — so they either never
-- reached it or the publication was recreated afterwards. This migration is
-- written to be safe to re-run either way.
--
-- REPLICA IDENTITY FULL is required, not optional: these tables have RLS, and
-- Realtime must see the complete old row to evaluate the policy before it may
-- deliver an UPDATE or DELETE. With the default (primary key only) those
-- events are dropped silently.
-- ═══════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'youtube_jobs',
    'transcription_jobs',
    'transcripts',
    'diarization_jobs',
    'comparison_runs',
    'folders',
    'user_preferences'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip anything not present in this environment rather than failing the
    -- whole migration.
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      RAISE NOTICE 'skipping %: table not found', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'added % to supabase_realtime', t;
    END IF;
  END LOOP;
END $$;
