// Deploy Edge Function Script
// Usage: node scripts/deploy-fn.mjs <slug>
// Reads the source code from supabase/functions/<slug>/index.ts
// and deploys it via the deploy_edge_fn database function.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SUPABASE_URL = 'https://pycryoyipkymaqorgpjy.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Y3J5b3lpcGt5bWFxb3JncGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTY4MDcsImV4cCI6MjA5NjY3MjgwN30.KRCp-SoyxzvGb9BHLwa-yTAN1A95TjRFAQHTOD1qEzg';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('❌ Missing ADMIN_EMAIL or ADMIN_PASSWORD environment variables.');
  console.error('   Set them before running: $env:ADMIN_EMAIL="..."; $env:ADMIN_PASSWORD="..."');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log('═'.repeat(50));
  console.log('   🚀 Edge Function Deployer');
  console.log('═'.repeat(50));

  if (!command) {
    console.log('\nUsage:');
    console.log('  node scripts/deploy-fn.mjs <slug>         Deploy a function');
    console.log('  node scripts/deploy-fn.mjs all             Deploy all functions');
    console.log('  node scripts/deploy-fn.mjs list             List deployable functions');
    console.log('  node scripts/deploy-fn.mjs check            Check if deploy system is ready');
    console.log('\nExamples:');
    console.log('  node scripts/deploy-fn.mjs transcribe-assemblyai');
    console.log('  node scripts/deploy-fn.mjs all');
    process.exit(0);
  }

  // Login
  console.log('\n🔐 Logging in...');
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
  });
  if (authError) {
    console.error('❌ Login failed:', authError.message);
    process.exit(1);
  }
  console.log('✅ Logged in as:', authData.user.email);

  if (command === 'check') {
    await checkReady();
  } else if (command === 'list') {
    listFunctions();
  } else if (command === 'all') {
    await deployAll();
  } else {
    await deploySingle(command);
  }

  await supabase.auth.signOut();
  console.log('\n🏁 Done!');
}

async function checkReady() {
  console.log('\n📋 Checking deploy system...');

  // Check http extension
  const { data: d1 } = await supabase.rpc('exec_sql_return', {
    query: "SELECT json_agg(extname) FROM pg_extension WHERE extname = 'http'"
  });
  const httpOk = d1 && d1.length > 0;
  console.log(`  http extension: ${httpOk ? '✅' : '❌ Not installed'}`);

  // Check system_secrets table
  const { data: d2 } = await supabase.rpc('exec_sql_return', {
    query: "SELECT json_agg(table_name) FROM information_schema.tables WHERE table_name = 'system_secrets' AND table_schema = 'public'"
  });
  const tableOk = d2 && d2.length > 0;
  console.log(`  system_secrets table: ${tableOk ? '✅' : '❌ Not created'}`);

  // Check deploy_edge_fn function
  const { data: d3 } = await supabase.rpc('exec_sql_return', {
    query: "SELECT json_agg(proname) FROM pg_proc WHERE proname = 'deploy_edge_fn'"
  });
  const fnOk = d3 && d3.length > 0;
  console.log(`  deploy_edge_fn function: ${fnOk ? '✅' : '❌ Not created'}`);

  // Check token exists (we can't read it, just check existence)
  if (tableOk) {
    const { data: d4 } = await supabase.rpc('exec_sql_return', {
      query: "SELECT json_build_object('exists', EXISTS(SELECT 1 FROM public.system_secrets WHERE key = 'SUPABASE_MANAGEMENT_TOKEN'))"
    });
    const tokenOk = d4?.exists;
    console.log(`  Management token: ${tokenOk ? '✅' : '❌ Not set'}`);
  }

  if (httpOk && tableOk && fnOk) {
    console.log('\n✅ Deploy system is ready!');
  } else {
    console.log('\n❌ Deploy system not ready. Ask Lovable to run the setup SQL.');
  }
}

function listFunctions() {
  const fnDir = path.join(PROJECT_ROOT, 'supabase', 'functions');
  const dirs = fs.readdirSync(fnDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => {
      const indexPath = path.join(fnDir, name, 'index.ts');
      return fs.existsSync(indexPath);
    });

  console.log(`\n📦 Deployable functions (${dirs.length}):`);
  for (const name of dirs) {
    const indexPath = path.join(fnDir, name, 'index.ts');
    const stats = fs.statSync(indexPath);
    const size = (stats.size / 1024).toFixed(1);
    console.log(`  • ${name} (${size} KB)`);
  }
}

async function deploySingle(slug) {
  const indexPath = path.join(PROJECT_ROOT, 'supabase', 'functions', slug, 'index.ts');
  if (!fs.existsSync(indexPath)) {
    console.error(`❌ Function not found: ${indexPath}`);
    process.exit(1);
  }

  const sourceCode = fs.readFileSync(indexPath, 'utf-8');
  console.log(`\n🚀 Deploying: ${slug} (${(sourceCode.length / 1024).toFixed(1)} KB)`);
  console.log('─'.repeat(50));

  const startTime = Date.now();
  const { data, error } = await supabase.rpc('deploy_edge_fn', {
    p_slug: slug,
    p_source_code: sourceCode,
  });

  const elapsed = Date.now() - startTime;

  if (error) {
    console.error(`❌ Deploy error: ${error.message}`);
    return false;
  }

  if (data?.status === 'success') {
    console.log(`✅ ${data.action === 'updated' ? 'Updated' : 'Created'}: ${slug} (${elapsed}ms)`);
    return true;
  } else {
    console.error(`❌ Deploy failed: ${JSON.stringify(data?.error || data, null, 2)}`);
    return false;
  }
}

async function deployAll() {
  const fnDir = path.join(PROJECT_ROOT, 'supabase', 'functions');
  const slugs = fs.readdirSync(fnDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => fs.existsSync(path.join(fnDir, name, 'index.ts')));

  console.log(`\n🚀 Deploying ${slugs.length} functions...`);
  console.log('─'.repeat(50));

  let success = 0;
  let failed = 0;

  for (const slug of slugs) {
    const ok = await deploySingle(slug);
    if (ok) success++;
    else failed++;
  }

  console.log('─'.repeat(50));
  console.log(`📊 Results: ${success} succeeded, ${failed} failed`);
}

main().catch(console.error);
