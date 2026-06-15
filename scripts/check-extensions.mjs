// Enable http extension and create deploy function via direct service role access
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pycryoyipkymaqorgpjy.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Y3J5b3lpcGt5bWFxb3JncGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTY4MDcsImV4cCI6MjA5NjY3MjgwN30.KRCp-SoyxzvGb9BHLwa-yTAN1A95TjRFAQHTOD1qEzg';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function callRunMigrationRaw(jwt, sql, fileName) {
  // Call run-migration edge function which has service role access
  const res = await fetch(`${SUPABASE_URL}/functions/v1/run-migration`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, fileName }),
  });
  const body = await res.json();
  return body;
}

async function main() {
  console.log('🔐 Logging in...');
  const email = process.env.ADMIN_EMAIL || '';
  const pw = process.env.ADMIN_PASSWORD || '';
  if (!email || !pw) { console.error('Set ADMIN_EMAIL & ADMIN_PASSWORD env vars'); process.exit(1); }
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: pw,
  });
  if (error) { console.error('Login failed:', error.message); return; }
  const jwt = data.session.access_token;
  console.log('✅ Logged in');

  // Step 1: Check if http extension exists
  console.log('\n📋 Step 1: Check http extension...');
  let res = await callRunMigrationRaw(jwt, 
    "SELECT extname FROM pg_extension WHERE extname = 'http'", 
    'check_http_ext');
  console.log('  Result:', res.status, res.result || res.error);

  // The run-migration goes through execute_sql_admin which may not allow CREATE EXTENSION.
  // But we can check if the extension is available and try via a different route.
  
  // Step 2: Try to enable http extension via the edge function
  // The edge function's adminClient uses service role key - let's see if we can use it
  // to call a raw SQL endpoint
  console.log('\n📋 Step 2: Try enabling http extension...');
  
  // Try using pg_net extension instead (already available in Supabase)
  res = await callRunMigrationRaw(jwt,
    "SELECT extname FROM pg_extension WHERE extname IN ('http', 'pg_net')",
    'check_extensions');
  console.log('  Result:', res.status, res.result || res.error);

  // Check available extensions
  console.log('\n📋 Step 3: Check available extensions...');
  res = await callRunMigrationRaw(jwt,
    "SELECT name, default_version FROM pg_available_extensions WHERE name IN ('http', 'pg_net', 'pgsodium') ORDER BY name",
    'available_ext');
  console.log('  Result:', res.status, res.result || res.error);

  // Check if pg_net is already enabled (it's built into Supabase)
  console.log('\n📋 Step 4: Check pg_net status...');
  res = await callRunMigrationRaw(jwt,
    "SELECT proname FROM pg_proc WHERE proname LIKE 'net%' LIMIT 10",
    'check_pg_net');
  console.log('  Result:', res.status, res.result || res.error);

  await supabase.auth.signOut();
  console.log('\n🏁 Done!');
}

main().catch(console.error);
