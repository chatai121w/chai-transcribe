// Direct Migration Runner for smart-hebrew-transcriber
// Logs in via Supabase Auth, calls run-migration edge function

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase configuration
const SUPABASE_URL = 'https://pycryoyipkymaqorgpjy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Y3J5b3lpcGt5bWFxb3JncGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTY4MDcsImV4cCI6MjA5NjY3MjgwN30.KRCp-SoyxzvGb9BHLwa-yTAN1A95TjRFAQHTOD1qEzg';

// Admin credentials — email is fixed, password from env or prompt
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jj1212t@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function askPassword() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question('🔑 Enter admin password: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function login(password) {
  console.log('🔐 Logging in as admin...');

  const { data, error } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password,
  });

  if (error) {
    console.error('❌ Login failed:', error.message);
    return null;
  }

  console.log('✅ Logged in as:', data.user.email);
  return data.session.access_token;
}

async function runMigrationViaEdge(accessToken, sql, fileName) {
  const url = `${SUPABASE_URL}/functions/v1/run-migration`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ sql, fileName }),
  });

  const body = await res.json();

  if (!res.ok) {
    console.error('❌ Edge function error:', res.status, body.error || body);
    return { success: false, error: body.error };
  }

  if (body.status === 'success') {
    console.log('✅ Migration completed successfully!');
    if (body.result) console.log('   Result:', body.result);
    console.log(`   Time: ${body.executionTime}ms`);
    return { success: true, data: body };
  } else {
    console.error('❌ Migration failed:', body.error);
    return { success: false, error: body.error };
  }
}

async function main() {
  console.log('═'.repeat(50));
  console.log('   🔧 Direct Migration Runner');
  console.log('═'.repeat(50));

  const password = ADMIN_PASSWORD || await askPassword();
  if (!password) {
    console.error('❌ Password required');
    process.exit(1);
  }

  const token = await login(password);
  if (!token) process.exit(1);

  const args = process.argv.slice(2);
  const command = args[0] || 'pending';

  switch (command) {
    case 'sql': {
      const sql = args[1];
      const name = args[2] || `direct_${Date.now()}`;
      if (!sql) {
        console.error('❌ Please provide SQL');
        console.log('Usage: node scripts/direct-run.mjs sql "SELECT 1" [name]');
        process.exit(1);
      }
      console.log(`\n🚀 Running SQL: ${name}`);
      console.log('─'.repeat(50));
      await runMigrationViaEdge(token, sql, name);
      break;
    }

    case 'file': {
      const filePath = args[1];
      if (!filePath) {
        console.error('❌ Please provide file path');
        process.exit(1);
      }
      const fullPath = path.resolve(filePath);
      if (!fs.existsSync(fullPath)) {
        console.error('❌ File not found:', fullPath);
        process.exit(1);
      }
      const fileSql = fs.readFileSync(fullPath, 'utf-8');
      const fileName = path.basename(filePath, '.sql');
      console.log(`\n🚀 Running migration: ${fileName}`);
      console.log('─'.repeat(50));
      await runMigrationViaEdge(token, fileSql, fileName);
      break;
    }

    default:
      console.log('Commands:');
      console.log('  sql "..." [name]  - Run direct SQL');
      console.log('  file <path>       - Run SQL from file');
      console.log('');
      console.log('Environment:');
      console.log('  ADMIN_EMAIL     - Override admin email');
      console.log('  ADMIN_PASSWORD  - Skip password prompt');
  }

  await supabase.auth.signOut();
  console.log('\n🏁 Done!');
}

main().catch(console.error);
