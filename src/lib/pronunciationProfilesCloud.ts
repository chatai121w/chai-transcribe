/**
 * Cloud sync for pronunciation profiles (Supabase).
 *
 * Storage table: public.pronunciation_profiles_cloud
 *   id          text PK   (matches local profile id)
 *   user_id     uuid      (auth.uid())
 *   name        text
 *   payload     jsonb     (full ProfileExport without `version` wrapper)
 *   updated_at  timestamptz
 *
 * Sync model: last-write-wins per profile by `updated_at`. On `pullFromCloud`,
 * any cloud profile newer than local replaces local; on `pushToCloud`, every
 * local profile whose `updatedAt` is newer than cloud's `updated_at` is
 * upserted. Profile deletions are not propagated automatically — the user
 * must delete on each device.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  exportProfile,
  importProfile,
  listProfiles,
  type PronunciationProfile,
} from './pronunciationProfiles';

const AUTOSYNC_KEY = 'pp_cloud_autosync';
const LAST_SYNC_KEY = 'pp_cloud_last_sync';

export function isAutoSyncEnabled(): boolean {
  try { return localStorage.getItem(AUTOSYNC_KEY) === '1'; } catch { return false; }
}

export function setAutoSyncEnabled(enabled: boolean): void {
  try { localStorage.setItem(AUTOSYNC_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
}

export function getLastSyncTime(): number {
  try {
    const v = localStorage.getItem(LAST_SYNC_KEY);
    return v ? parseInt(v, 10) : 0;
  } catch { return 0; }
}

function setLastSyncTime(ts: number): void {
  try { localStorage.setItem(LAST_SYNC_KEY, String(ts)); } catch { /* ignore */ }
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  errors: string[];
}

/**
 * Push every local profile to the cloud. Each row is upserted by id.
 */
export async function pushToCloud(): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, errors: [] };
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) {
    result.errors.push('לא מחובר — אין סנכרון');
    return result;
  }
  const profiles = listProfiles();
  if (profiles.length === 0) return result;

  const rows = profiles
    .map((p) => {
      const json = exportProfile(p.id);
      if (!json) return null;
      return {
        id: p.id,
        user_id: userId,
        name: p.name,
        payload: JSON.parse(json),
        updated_at: new Date(p.updatedAt).toISOString(),
      };
    })
    .filter(Boolean) as Array<{ id: string; user_id: string; name: string; payload: unknown; updated_at: string }>;

  // Upsert in chunks of 25 to avoid request size limits.
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25);
    const { error } = await (supabase as any)
      .from('pronunciation_profiles_cloud')
      .upsert(chunk as any, { onConflict: 'id' });
    if (error) {
      result.errors.push(error.message);
    } else {
      result.pushed += chunk.length;
    }
  }
  return result;
}

/**
 * Pull profiles from cloud. Any cloud profile newer than local (or absent
 * locally) is imported. Returns count pulled.
 */
export async function pullFromCloud(): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, pulled: 0, errors: [] };
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) {
    result.errors.push('לא מחובר — אין סנכרון');
    return result;
  }

  const { data, error } = await (supabase as any)
    .from('pronunciation_profiles_cloud')
    .select('id, name, payload, updated_at')
    .eq('user_id', userId);

  if (error) {
    result.errors.push(error.message);
    return result;
  }
  if (!data) return result;

  const local: Record<string, PronunciationProfile> = {};
  for (const p of listProfiles()) local[p.id] = p;

  for (const row of data as Array<{ id: string; name: string; payload: any; updated_at: string }>) {
    const cloudUpdated = new Date(row.updated_at).getTime();
    const localProfile = local[row.id];
    if (localProfile && localProfile.updatedAt >= cloudUpdated) continue;

    try {
      // importProfile creates a new id. We want to preserve cloud id —
      // wrap payload as a ProfileExport and call importProfile, then reconcile.
      const json = JSON.stringify(row.payload);
      const imported = importProfile(json);
      // Re-key the imported profile to match cloud id so later upserts align.
      reassignImportedProfileId(imported.id, row.id);
      result.pulled += 1;
    } catch (e: any) {
      result.errors.push(`${row.name}: ${e?.message || String(e)}`);
    }
  }

  setLastSyncTime(Date.now());
  return result;
}

/**
 * Re-key a freshly-imported local profile to a target id (so cloud upserts
 * match later). Touches the profile registry + every per-profile storage key.
 */
function reassignImportedProfileId(fromId: string, toId: string): void {
  if (fromId === toId) return;
  // Move per-profile keys.
  for (const kind of ['corrections', 'verified', 'approved', 'highlights']) {
    const fromKey = `pp_profile_${fromId}_${kind}`;
    const toKey = `pp_profile_${toId}_${kind}`;
    try {
      const v = localStorage.getItem(fromKey);
      if (v !== null) {
        localStorage.setItem(toKey, v);
        localStorage.removeItem(fromKey);
      }
    } catch { /* ignore */ }
  }
  // Update registry id.
  try {
    const idx = JSON.parse(localStorage.getItem('pp_profiles_index') || '[]') as PronunciationProfile[];
    const p = idx.find((x) => x.id === fromId);
    if (p) p.id = toId;
    localStorage.setItem('pp_profiles_index', JSON.stringify(idx));
  } catch { /* ignore */ }
}

/**
 * Two-way sync: pull then push. Suitable for "Sync now" button.
 */
export async function syncNow(): Promise<SyncResult> {
  const pull = await pullFromCloud();
  const push = await pushToCloud();
  return {
    pulled: pull.pulled,
    pushed: push.pushed,
    errors: [...pull.errors, ...push.errors],
  };
}

/**
 * Delete a single profile from the cloud (call when the user deletes locally
 * with auto-sync on).
 */
export async function deleteFromCloud(profileId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) return;
  await (supabase as any)
    .from('pronunciation_profiles_cloud')
    .delete()
    .eq('user_id', userId)
    .eq('id', profileId);
}
