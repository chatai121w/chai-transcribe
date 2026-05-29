import { db, isDbAvailable, type LocalTranscript, type LocalPreferences, type LocalApiKeys } from './localDb';
import { supabase } from '@/integrations/supabase/client';
import { debugLog } from './debugLogger';

// ─── Sync Engine ─────────────────────────────────────────────────
// Responsible for keeping local IndexedDB ↔ Supabase cloud in sync.
// Strategy: local-first reads, write-through to cloud, periodic pull.

const SYNC_COOLDOWN_MS = 30_000; // minimum 30s between full syncs
let lastSyncTime = 0;

/** Full sync: pull cloud → local, push dirty local → cloud */
export async function syncAll(userId: string): Promise<void> {
  if (!(await isDbAvailable())) return;
  const now = Date.now();
  if (now - lastSyncTime < SYNC_COOLDOWN_MS) return;
  lastSyncTime = now;

  debugLog.info('Sync', 'Starting full sync...');
  try {
    await Promise.all([
      syncTranscriptsDown(userId),
      syncPreferencesDown(userId),
      syncApiKeysDown(userId),
    ]);
    await Promise.all([
      pushDirtyTranscripts(userId),
      pushDirtyPreferences(userId),
      pushDirtyApiKeys(userId),
    ]);
    debugLog.info('Sync', 'Full sync complete');
  } catch (err) {
    debugLog.error('Sync', 'Sync failed', err instanceof Error ? err.message : String(err));
  }
}

// ─── Transcripts ─────────────────────────────────────────────────

/** Pull transcripts from cloud → local DB */
export async function syncTranscriptsDown(userId: string): Promise<void> {
  if (!(await isDbAvailable())) return;

  const meta = await db.syncMeta.get('transcripts');
  const lastSynced = meta?.last_cloud_updated_at || '1970-01-01T00:00:00Z';

  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .gt('updated_at', lastSynced)
    .order('updated_at', { ascending: true })
    .limit(500);

  if (error || !data?.length) return;

  await db.transaction('rw', db.transcripts, db.syncMeta, async () => {
    for (const row of data) {
      const existing = await db.transcripts.get(row.id);
      // Don't overwrite locally dirty records
      if (existing?._dirty) continue;

      await db.transcripts.put({
        id: row.id,
        user_id: row.user_id,
        text: row.text,
        engine: row.engine,
        tags: row.tags || [],
        notes: row.notes || '',
        title: row.title || '',
        folder: row.folder || '',
        category: row.category || '',
        is_favorite: row.is_favorite || false,
        audio_file_path: row.audio_file_path,
        word_timings: row.word_timings as any || null,
        edited_text: row.edited_text || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        _dirty: false,
        _deleted: false,
      });
    }
    await db.syncMeta.put({
      id: 'transcripts',
      last_synced_at: new Date().toISOString(),
      last_cloud_updated_at: data[data.length - 1].updated_at,
    });
  });

  debugLog.info('Sync', `Pulled ${data.length} transcripts from cloud`);
}

/** Push locally dirty transcripts → cloud */
async function pushDirtyTranscripts(userId: string): Promise<void> {
  if (!(await isDbAvailable())) return;

  // Handle deletes first
  const deleted = await db.transcripts.where('_deleted').equals(1).toArray();
  for (const t of deleted) {
    const { error } = await supabase.from('transcripts').delete().eq('id', t.id);
    if (!error) await db.transcripts.delete(t.id);
  }

  // Handle inserts/updates
  const dirty = await db.transcripts.where('_dirty').equals(1).toArray();
  for (const t of dirty) {
    const { id, audio_blob, _dirty, _deleted, word_timings, ...row } = t;
    const { error } = await supabase
      .from('transcripts')
      .upsert({ id, ...row, word_timings: word_timings as any ?? null, updated_at: new Date().toISOString() } as any, { onConflict: 'id' });

    if (!error) {
      await db.transcripts.update(id, { _dirty: false });
    }
  }

  if (deleted.length + dirty.length > 0) {
    debugLog.info('Sync', `Pushed ${dirty.length} upserts, ${deleted.length} deletes`);
  }
}

/** Load transcripts from local DB (fast, offline-capable) */
export async function getLocalTranscripts(userId: string): Promise<LocalTranscript[]> {
  if (!(await isDbAvailable())) return [];
  return db.transcripts
    .where('user_id').equals(userId)
    .and(t => !t._deleted)
    .reverse()
    .sortBy('created_at');
}

/** Save a transcript locally, mark dirty for cloud push */
export async function saveTranscriptLocally(transcript: Omit<LocalTranscript, '_dirty' | '_deleted'>): Promise<void> {
  if (!(await isDbAvailable())) return;
  await db.transcripts.put({ ...transcript, _dirty: true, _deleted: false });
}

/** Update a transcript locally */
export async function updateTranscriptLocally(id: string, updates: Partial<LocalTranscript>): Promise<void> {
  if (!(await isDbAvailable())) return;
  await db.transcripts.update(id, { ...updates, updated_at: new Date().toISOString(), _dirty: true });
}

/** Mark a transcript as deleted locally */
export async function deleteTranscriptLocally(id: string): Promise<void> {
  if (!(await isDbAvailable())) return;
  await db.transcripts.update(id, { _deleted: true, _dirty: false });
}

// ─── Preferences ─────────────────────────────────────────────────

/** Pull preferences from cloud → local DB */
export async function syncPreferencesDown(userId: string): Promise<void> {
  if (!(await isDbAvailable())) return;

  const { data } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return;

  const existing = await db.preferences.get('current');
  if (existing?._dirty) return; // Don't overwrite local changes

  await db.preferences.put({
    id: 'current',
    user_id: userId,
    font_size: data.font_size ?? 16,
    font_family: data.font_family ?? 'Assistant',
    text_color: data.text_color ?? 'hsl(var(--foreground))',
    line_height: Number(data.line_height) || 1.6,
    sidebar_pinned: data.sidebar_pinned ?? false,
    theme: data.theme ?? 'default',
    engine: (data as Record<string, unknown>).engine as string ?? 'groq',
    source_language: (data as Record<string, unknown>).source_language as string ?? 'auto',
    custom_themes: typeof (data as Record<string, unknown>).custom_themes === 'string'
      ? (data as Record<string, unknown>).custom_themes as string
      : JSON.stringify((data as Record<string, unknown>).custom_themes ?? []),
    editor_columns: (data as Record<string, unknown>).editor_columns as number ?? 1,
    cuda_preset: (data as Record<string, unknown>).cuda_preset as string ?? 'balanced',
    cuda_fast_mode: (data as Record<string, unknown>).cuda_fast_mode as boolean ?? true,
    cuda_compute_type: (data as Record<string, unknown>).cuda_compute_type as string ?? 'int8_float16',
    cuda_beam_size: (data as Record<string, unknown>).cuda_beam_size as number ?? 1,
    cuda_no_condition_prev: (data as Record<string, unknown>).cuda_no_condition_prev as boolean ?? true,
    cuda_vad_aggressive: (data as Record<string, unknown>).cuda_vad_aggressive as boolean ?? false,
    cuda_hotwords: (data as Record<string, unknown>).cuda_hotwords as string ?? '',
    cuda_paragraph_threshold: (data as Record<string, unknown>).cuda_paragraph_threshold as number ?? 0,
    cuda_preload_mode: (data as Record<string, unknown>).cuda_preload_mode as string ?? 'preload',
    cuda_cloud_save: (data as Record<string, unknown>).cuda_cloud_save as string ?? 'immediate',
    personal_pronunciation_enabled: (data as Record<string, unknown>).personal_pronunciation_enabled as boolean ?? true,
    updated_at: data.updated_at,
    _dirty: false,
  });
}

/** Push dirty preferences → cloud */
async function pushDirtyPreferences(userId: string): Promise<void> {
  if (!(await isDbAvailable())) return;

  const prefs = await db.preferences.get('current');
  if (!prefs?._dirty) return;

  let customThemesParsed: unknown = [];
  try { customThemesParsed = JSON.parse(prefs.custom_themes); } catch { /* parse error ok */ }

  const { error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: userId,
      font_size: prefs.font_size,
      font_family: prefs.font_family,
      text_color: prefs.text_color,
      line_height: prefs.line_height,
      sidebar_pinned: prefs.sidebar_pinned,
      theme: prefs.theme,
      engine: prefs.engine,
      source_language: prefs.source_language,
      custom_themes: customThemesParsed,
      editor_columns: prefs.editor_columns,
      cuda_preset: prefs.cuda_preset,
      cuda_fast_mode: prefs.cuda_fast_mode,
      cuda_compute_type: prefs.cuda_compute_type,
      cuda_beam_size: prefs.cuda_beam_size,
      cuda_no_condition_prev: prefs.cuda_no_condition_prev,
      cuda_vad_aggressive: prefs.cuda_vad_aggressive,
      cuda_hotwords: prefs.cuda_hotwords,
      cuda_paragraph_threshold: prefs.cuda_paragraph_threshold,
      cuda_preload_mode: prefs.cuda_preload_mode,
      cuda_cloud_save: prefs.cuda_cloud_save,
      personal_pronunciation_enabled: prefs.personal_pronunciation_enabled,
      updated_at: new Date().toISOString(),
    } as any, { onConflict: 'user_id' });

  if (error) {
    // Fallback: save without CUDA columns if they don't exist yet
    const { error: error2 } = await supabase
      .from('user_preferences')
      .upsert({
        user_id: userId,
        font_size: prefs.font_size,
        font_family: prefs.font_family,
        text_color: prefs.text_color,
        line_height: prefs.line_height,
        sidebar_pinned: prefs.sidebar_pinned,
        theme: prefs.theme,
        engine: prefs.engine,
        source_language: prefs.source_language,
        custom_themes: customThemesParsed,
        editor_columns: prefs.editor_columns,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: 'user_id' });

    if (!error2) {
      await db.preferences.update('current', { _dirty: false });
    }
  } else {
    await db.preferences.update('current', { _dirty: false });
  }
}

/** Get preferences from local DB */
export async function getLocalPreferences(): Promise<LocalPreferences | null> {
  if (!(await isDbAvailable())) return null;
  return (await db.preferences.get('current')) ?? null;
}

/** Save preferences locally */
export async function savePreferencesLocally(prefs: Omit<LocalPreferences, '_dirty'>): Promise<void> {
  if (!(await isDbAvailable())) return;
  await db.preferences.put({ ...prefs, _dirty: true });
}

// ─── API Keys ────────────────────────────────────────────────────

/** Pull API keys from cloud → local DB */
export async function syncApiKeysDown(userId: string): Promise<void> {
  if (!(await isDbAvailable())) return;

  const { data } = await supabase
    .from('user_api_keys')
    .select('*')
    .eq('user_identifier', userId)
    .maybeSingle();

  if (!data) return;

  const existing = await db.apiKeys.get('current');
  if (existing?._dirty) return;

  await db.apiKeys.put({
    id: 'current',
    user_identifier: userId,
    openai_key: data.openai_key || '',
    google_key: data.google_key || '',
    groq_key: data.groq_key || '',
    claude_key: data.claude_key || '',
    assemblyai_key: data.assemblyai_key || '',
    deepgram_key: data.deepgram_key || '',
    updated_at: data.updated_at,
    _dirty: false,
  });
}

/** Push dirty API keys → cloud */
async function pushDirtyApiKeys(userId: string): Promise<void> {
  if (!(await isDbAvailable())) return;

  const keys = await db.apiKeys.get('current');
  if (!keys?._dirty) return;

  const { error } = await supabase
    .from('user_api_keys')
    .upsert({
      user_identifier: userId,
      openai_key: keys.openai_key,
      google_key: keys.google_key,
      groq_key: keys.groq_key,
      claude_key: keys.claude_key,
      assemblyai_key: keys.assemblyai_key,
      deepgram_key: keys.deepgram_key,
    }, { onConflict: 'user_identifier' });

  if (!error) {
    await db.apiKeys.update('current', { _dirty: false });
  }
}

/** Get API keys from local DB */
export async function getLocalApiKeys(): Promise<LocalApiKeys | null> {
  if (!(await isDbAvailable())) return null;
  return (await db.apiKeys.get('current')) ?? null;
}

/** Save API keys locally */
export async function saveApiKeysLocally(keys: Omit<LocalApiKeys, '_dirty'>): Promise<void> {
  if (!(await isDbAvailable())) return;
  await db.apiKeys.put({ ...keys, _dirty: true });
}

// ─── Cloud delete detection ──────────────────────────────────────
// Handles records deleted in cloud but still in local DB
export async function reconcileDeletedTranscripts(userId: string, cloudIds: Set<string>): Promise<void> {
  if (!(await isDbAvailable())) return;
  const localIds = await db.transcripts
    .where('user_id').equals(userId)
    .and(t => !t._dirty && !t._deleted)
    .primaryKeys();

  const toDelete = localIds.filter(id => !cloudIds.has(id));
  if (toDelete.length > 0) {
    await db.transcripts.bulkDelete(toDelete);
    debugLog.info('Sync', `Removed ${toDelete.length} locally that were deleted from cloud`);
  }
}
