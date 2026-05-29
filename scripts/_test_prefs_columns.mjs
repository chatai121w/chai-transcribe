// Quick verification: check new columns exist + read/write a test value
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://kjjljpllyjnvitemapox.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtqamxqcGxseWpudml0ZW1hcG94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNjM2NDksImV4cCI6MjA4ODczOTY0OX0.V6z69-vY-z5c1yA-fAP_X0PKWCzrS2Es4sfOckAet4I';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

const email = 'jj1212t@gmail.com';
const password = process.env.ADMIN_PASSWORD || '543211';

console.log('🔐 Logging in...');
const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
if (authErr) { console.error('❌ Login failed:', authErr.message); process.exit(1); }
console.log('✅ Logged in as:', authData.user.email);

// ── 1. Read current values ──────────────────────────────────────────
console.log('\n📖 Reading current preferences from Supabase...');
const { data: before, error: readErr } = await supabase
  .from('user_preferences')
  .select('loshon_kodesh_enabled, active_pronunciation_profile, diarize_enabled')
  .eq('user_id', authData.user.id)
  .maybeSingle();

if (readErr) { console.error('❌ Read error:', readErr.message); process.exit(1); }
if (!before) { console.log('⚠️  No preferences row found yet (will be created on first login).'); process.exit(0); }

console.log('Current values:', JSON.stringify(before, null, 2));

// ── 2. Write test values ────────────────────────────────────────────
console.log('\n✏️  Writing test values (loshon=true, diarize=true, profile="test_prof")...');
const { error: writeErr } = await supabase
  .from('user_preferences')
  .update({
    loshon_kodesh_enabled: true,
    diarize_enabled: true,
    active_pronunciation_profile: 'test_prof',
    updated_at: new Date().toISOString(),
  })
  .eq('user_id', authData.user.id);

if (writeErr) { console.error('❌ Write error:', writeErr.message); process.exit(1); }
console.log('✅ Write succeeded');

// ── 3. Read back ────────────────────────────────────────────────────
console.log('\n📖 Reading back to verify...');
const { data: after, error: readErr2 } = await supabase
  .from('user_preferences')
  .select('loshon_kodesh_enabled, active_pronunciation_profile, diarize_enabled')
  .eq('user_id', authData.user.id)
  .maybeSingle();

if (readErr2) { console.error('❌ Read error:', readErr2.message); process.exit(1); }
console.log('Values after write:', JSON.stringify(after, null, 2));

const ok = after.loshon_kodesh_enabled === true &&
           after.diarize_enabled === true &&
           after.active_pronunciation_profile === 'test_prof';
console.log(ok ? '\n✅ ALL CHECKS PASSED — settings save and load correctly!' : '\n❌ MISMATCH — something is wrong');

// ── 4. Restore original values ──────────────────────────────────────
await supabase.from('user_preferences').update({
  loshon_kodesh_enabled: before.loshon_kodesh_enabled,
  diarize_enabled: before.diarize_enabled,
  active_pronunciation_profile: before.active_pronunciation_profile,
  updated_at: new Date().toISOString(),
}).eq('user_id', authData.user.id);
console.log('🔄 Restored original values');
