import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function loadLocalEnv() {
  const envPath = path.resolve('.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

loadLocalEnv();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

assert(url && key, 'Supabase URL or publishable key is missing');
assert(email && password, 'ADMIN_EMAIL and ADMIN_PASSWORD are required');

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const insertedIds = [];
let summary;

try {
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
  if (authError) throw authError;
  const userId = authData.user?.id;
  assert(userId, 'Authenticated user id is missing');

  const probe = await supabase
    .from('asr_learned_corrections')
    .select('scope,profile_id')
    .limit(1);
  if (probe.error) throw new Error(`Schema probe failed: ${probe.error.message}`);

  const tag = `codex-cloud-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseRow = {
    user_id: userId,
    original: `${tag}-source`,
    corrected: `${tag}-target`,
    engine: 'cloud-verification',
    category: 'word',
  };

  const globalInsert = await supabase
    .from('asr_learned_corrections')
    .insert({ ...baseRow, scope: 'global', profile_id: '' })
    .select('id,scope,profile_id')
    .single();
  if (globalInsert.error) throw new Error(`Global insert failed: ${globalInsert.error.message}`);
  insertedIds.push(globalInsert.data.id);
  assert(globalInsert.data.scope === 'global' && globalInsert.data.profile_id === '', 'Global scope was not persisted exactly');

  const duplicateInsert = await supabase
    .from('asr_learned_corrections')
    .insert({ ...baseRow, scope: 'global', profile_id: '' });
  assert(duplicateInsert.error?.code === '23505', `Duplicate was not rejected by the unique constraint (${duplicateInsert.error?.code || 'no error'})`);

  const invalidProfileInsert = await supabase
    .from('asr_learned_corrections')
    .insert({ ...baseRow, scope: 'profile', profile_id: '' });
  assert(invalidProfileInsert.error?.code === '23514', `Invalid profile scope was not rejected by the check constraint (${invalidProfileInsert.error?.code || 'no error'})`);

  const profileInsert = await supabase
    .from('asr_learned_corrections')
    .insert({ ...baseRow, scope: 'profile', profile_id: tag })
    .select('id,scope,profile_id')
    .single();
  if (profileInsert.error) throw new Error(`Profile insert failed: ${profileInsert.error.message}`);
  insertedIds.push(profileInsert.data.id);
  assert(profileInsert.data.scope === 'profile' && profileInsert.data.profile_id === tag, 'Profile scope was not persisted exactly');

  const verification = await supabase
    .from('asr_learned_corrections')
    .select('id,scope,profile_id,original,corrected')
    .in('id', insertedIds);
  if (verification.error) throw new Error(`Verification read failed: ${verification.error.message}`);
  assert(verification.data.length === 2, `Expected two isolated scope rows, received ${verification.data.length}`);
  assert(new Set(verification.data.map(row => row.scope)).size === 2, 'Global and profile rows were not isolated');

  summary = {
    status: 'ok',
    schemaColumnsReadable: true,
    globalScopePersisted: true,
    profileScopePersisted: true,
    duplicateRejected: true,
    invalidScopeRejected: true,
    isolatedRowsVerified: verification.data.length,
  };
} finally {
  if (insertedIds.length) {
    const cleanup = await supabase.from('asr_learned_corrections').delete().in('id', insertedIds);
    if (cleanup.error) throw new Error(`Cloud verification cleanup failed: ${cleanup.error.message}`);
    const cleanupProbe = await supabase.from('asr_learned_corrections').select('id').in('id', insertedIds);
    if (cleanupProbe.error) throw new Error(`Cloud verification cleanup probe failed: ${cleanupProbe.error.message}`);
    assert(cleanupProbe.data.length === 0, `Cloud verification left ${cleanupProbe.data.length} temporary rows behind`);
    if (summary) summary.cleanupVerified = true;
  }
  await supabase.auth.signOut();
}

assert(summary, 'Cloud verification did not produce a result');
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
