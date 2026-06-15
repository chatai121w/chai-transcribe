import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://pycryoyipkymaqorgpjy.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Y3J5b3lpcGt5bWFxb3JncGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTY4MDcsImV4cCI6MjA5NjY3MjgwN30.KRCp-SoyxzvGb9BHLwa-yTAN1A95TjRFAQHTOD1qEzg';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function main() {
  console.log('🔐 Logging in...');
  const email = process.env.ADMIN_EMAIL || '';
  const pw = process.env.ADMIN_PASSWORD || '';
  if (!email || !pw) { console.error('Set ADMIN_EMAIL & ADMIN_PASSWORD env vars'); process.exit(1); }
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: pw,
  });

  if (error) {
    console.error('Login failed:', error.message);
    return;
  }

  const jwt = data.session.access_token;
  console.log('✅ Logged in');

  // Test 1: Check if the token is configured
  console.log('\n📡 Testing deploy-edge-function...');
  const testCode = `Deno.serve(() => new Response("pong from test " + new Date().toISOString()));`;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/deploy-edge-function`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'apikey': ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      slug: 'test-ping',
      sourceCode: testCode,
    }),
  });

  console.log('Status:', res.status);
  const body = await res.text();
  console.log('Response:', body);

  await supabase.auth.signOut();
  console.log('\n🏁 Done!');
}

main().catch(console.error);
