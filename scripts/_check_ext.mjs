import { createClient } from '@supabase/supabase-js';
const sb = createClient('https://pycryoyipkymaqorgpjy.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Y3J5b3lpcGt5bWFxb3JncGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTY4MDcsImV4cCI6MjA5NjY3MjgwN30.KRCp-SoyxzvGb9BHLwa-yTAN1A95TjRFAQHTOD1qEzg');
const _e = process.env.ADMIN_EMAIL || '', _p = process.env.ADMIN_PASSWORD || '';
if (!_e || !_p) { console.error('Set ADMIN_EMAIL & ADMIN_PASSWORD env vars'); process.exit(1); }
await sb.auth.signInWithPassword({email:_e,password:_p});

// List all extensions
const {data: d1, error: e1} = await sb.rpc('exec_sql_return', {
  query: "SELECT json_agg(extname ORDER BY extname) as exts FROM pg_extension"
});
console.log('All extensions:', JSON.stringify(d1));
if (e1) console.log('Error:', JSON.stringify(e1));

// Try to create http extension
console.log('\nTrying CREATE EXTENSION http...');
const {data: d2, error: e2} = await sb.rpc('exec_sql', {
  query: "CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions"
});
console.log('Create result:', JSON.stringify(d2));
if (e2) console.log('Create error:', JSON.stringify(e2));

// Check again
const {data: d3, error: e3} = await sb.rpc('exec_sql_return', {
  query: "SELECT json_agg(extname ORDER BY extname) as exts FROM pg_extension"
});
console.log('\nExtensions after:', JSON.stringify(d3));
if (e3) console.log('Error:', JSON.stringify(e3));

process.exit(0);
