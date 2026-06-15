// Store AI API key in system_secrets so DB proxy works without edge function.
// Usage:
//   node scripts/set-ai-key.mjs <lovable-api-key>
// Gets key from Supabase Dashboard → Project Settings → Edge Functions → Secrets → LOVABLE_API_KEY

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pycryoyipkymaqorgpjy.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Y3J5b3lpcGt5bWFxb3JncGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTY4MDcsImV4cCI6MjA5NjY3MjgwN30.KRCp-SoyxzvGb9BHLwa-yTAN1A95TjRFAQHTOD1qEzg';
const ADMIN_EMAIL = 'jj1212t@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '543211';

const apiKey = process.argv[2];
const apiUrl = process.argv[3] || 'https://ai.gateway.lovable.dev/v1/chat/completions';

if (!apiKey) {
  console.log('Usage: node scripts/set-ai-key.mjs <api-key> [api-url]');
  console.log('');
  console.log('Get the LOVABLE_API_KEY from:');
  console.log('  Supabase Dashboard → pycryoyipkymaqorgpjy → Edge Functions → Secrets');
  process.exit(0);
}

const s = createClient(SUPABASE_URL, ANON_KEY);

const { error: authErr } = await s.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
if (authErr) { console.error('Login failed:', authErr.message); process.exit(1); }
console.log('Logged in as:', ADMIN_EMAIL);

// Use exec_sql to upsert
const sql = `
INSERT INTO system_secrets (key, value) VALUES 
  ('AI_API_KEY', '${apiKey.replace(/'/g, "''")}'),
  ('AI_API_URL', '${apiUrl.replace(/'/g, "''")}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, created_at = now()`;

const { error } = await s.rpc('exec_sql', { query: sql });
if (error) {
  console.error('Failed:', error.message);
} else {
  console.log('✅ Stored AI_API_KEY and AI_API_URL in system_secrets');
  console.log('   DB proxy will now work without edge function!');
  console.log('   URL:', apiUrl);
}
