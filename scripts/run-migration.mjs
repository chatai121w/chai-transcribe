// Run migration: add new columns to user_preferences
import { createClient } from '@supabase/supabase-js';

const url = 'https://pycryoyipkymaqorgpjy.supabase.co';
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Y3J5b3lpcGt5bWFxb3JncGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTY4MDcsImV4cCI6MjA5NjY3MjgwN30.KRCp-SoyxzvGb9BHLwa-yTAN1A95TjRFAQHTOD1qEzg';

const supabase = createClient(url, key);

// Sign in first (need authenticated user with admin role for exec_sql)
const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.log('Usage: node scripts/run-migration.mjs <email> <password>');
  process.exit(1);
}

const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) {
  console.error('Auth error:', authError.message);
  process.exit(1);
}

const sql = `
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS cuda_preset text DEFAULT 'balanced';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS cuda_fast_mode boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS cuda_compute_type text DEFAULT 'int8_float16';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS cuda_beam_size integer DEFAULT 1;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS cuda_no_condition_prev boolean DEFAULT true;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS cuda_vad_aggressive boolean DEFAULT false;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS cuda_hotwords text DEFAULT '';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS cuda_paragraph_threshold real DEFAULT 0;
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS cuda_preload_mode text DEFAULT 'preload';
ALTER TABLE public.user_preferences ADD COLUMN IF NOT EXISTS cuda_cloud_save text DEFAULT 'immediate';
`;

const { data, error } = await supabase.rpc('exec_sql', { query: sql });
if (error) {
  console.error('Migration error:', error.message);
  process.exit(1);
}
console.log('Migration successful:', data);
