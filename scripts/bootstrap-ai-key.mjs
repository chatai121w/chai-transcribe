// Bootstrap function: copies LOVABLE_API_KEY from edge function env into system_secrets
// so the DB proxy can use it directly.
// Call once: node scripts/bootstrap-ai-key.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pycryoyipkymaqorgpjy.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Y3J5b3lpcGt5bWFxb3JncGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTY4MDcsImV4cCI6MjA5NjY3MjgwN30.KRCp-SoyxzvGb9BHLwa-yTAN1A95TjRFAQHTOD1qEzg';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jj1212t@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function main() {
  const password = ADMIN_PASSWORD || process.argv[2];
  if (!password) {
    console.error('Usage: node scripts/bootstrap-ai-key.mjs <password>');
    console.error('  OR:  $env:ADMIN_PASSWORD="..." ; node scripts/bootstrap-ai-key.mjs');
    process.exit(1);
  }

  // Login
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL, password,
  });
  if (authErr) { console.error('Login failed:', authErr.message); process.exit(1); }
  console.log('Logged in as:', auth.user.email);

  // Call the bootstrap edge function (which has access to the secret)
  console.log('\nCalling bootstrap-ai-key edge function...');
  const { data, error } = await supabase.functions.invoke('bootstrap-ai-key', {});
  
  if (error) {
    console.error('Edge function error:', error.message);
    console.log('\nAlternative: store key manually with:');
    console.log('  node scripts/bootstrap-ai-key.mjs set <your-lovable-api-key>');
    
    const manualKey = process.argv[2] === 'set' ? process.argv[3] : null;
    if (manualKey) {
      await storeKey(manualKey, 'https://ai.gateway.lovable.dev/v1/chat/completions');
    }
    return;
  }

  console.log('Result:', JSON.stringify(data));
}

async function storeKey(key, url) {
  const sql1 = `INSERT INTO system_secrets (key, value) VALUES ('AI_API_KEY', '${key}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  const sql2 = `INSERT INTO system_secrets (key, value) VALUES ('AI_API_URL', '${url}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  
  const { error: e1 } = await supabase.rpc('exec_sql', { query: sql1 });
  const { error: e2 } = await supabase.rpc('exec_sql', { query: sql2 });

  if (!e1 && !e2) {
    console.log('✅ AI_API_KEY and AI_API_URL stored in system_secrets');
    console.log('   DB proxy will now work without the edge function!');
  } else {
    if (e1) console.error('Error storing key:', e1.message);
    if (e2) console.error('Error storing URL:', e2.message);
  }
}

main().catch(console.error);
