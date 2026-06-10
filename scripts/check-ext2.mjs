import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pycryoyipkymaqorgpjy.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Y3J5b3lpcGt5bWFxb3JncGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTY4MDcsImV4cCI6MjA5NjY3MjgwN30.KRCp-SoyxzvGb9BHLwa-yTAN1A95TjRFAQHTOD1qEzg';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function main() {
  const email = process.env.ADMIN_EMAIL || '';
  const pw = process.env.ADMIN_PASSWORD || '';
  if (!email || !pw) { console.error('Set ADMIN_EMAIL & ADMIN_PASSWORD env vars'); process.exit(1); }
  const { data: authData } = await supabase.auth.signInWithPassword({
    email, password: pw,
  });
  if (!authData.session) { console.error('Login failed'); return; }

  // Check available extensions
  const { data: d1, error: e1 } = await supabase.rpc('exec_sql_return', {
    query: "SELECT json_agg(row_to_json(t)) FROM (SELECT name FROM pg_available_extensions WHERE name IN ('http', 'pg_net', 'pgsodium') ORDER BY name) t"
  });
  console.log('Available extensions:', JSON.stringify(d1));

  // Check installed extensions
  const { data: d2, error: e2 } = await supabase.rpc('exec_sql_return', {
    query: "SELECT json_agg(row_to_json(t)) FROM (SELECT extname FROM pg_extension ORDER BY extname) t"
  });
  console.log('Installed extensions:', JSON.stringify(d2));

  // Check if net schema functions exist (pg_net)
  const { data: d3, error: e3 } = await supabase.rpc('exec_sql_return', {
    query: "SELECT json_agg(row_to_json(t)) FROM (SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE p.proname LIKE 'http%' OR (n.nspname = 'net' AND p.proname IN ('http_get','http_post')) ORDER BY n.nspname, p.proname LIMIT 20) t"
  });
  console.log('HTTP functions:', JSON.stringify(d3));

  await supabase.auth.signOut();
}

main().catch(console.error);
