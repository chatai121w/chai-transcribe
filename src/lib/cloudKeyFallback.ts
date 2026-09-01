import { supabase } from "@/integrations/supabase/client";
import { setEncryptedKey } from "@/lib/keyCrypto";
import { debugLog } from "@/lib/debugLogger";

/**
 * Local API keys are encrypted with a per-session key (sessionStorage).
 * After a new browser session the stored "enc:..." blob can no longer be
 * decrypted, so the key looks missing even though it exists in the cloud.
 * This helper re-fetches the keys for the signed-in user on demand and
 * repopulates localStorage + the in-memory cache.
 */

const columnMap: Record<string, { single: string; pool: string; localSingle: string; localPool: string }> = {
  openai: { single: 'openai_key', pool: 'openai_keys_pool', localSingle: 'openai_api_key', localPool: 'openai_api_keys_pool' },
  groq: { single: 'groq_key', pool: 'groq_keys_pool', localSingle: 'groq_api_key', localPool: 'groq_api_keys_pool' },
  google: { single: 'google_key', pool: 'google_keys_pool', localSingle: 'google_api_key', localPool: 'google_api_keys_pool' },
  assemblyai: { single: 'assemblyai_key', pool: 'assemblyai_keys_pool', localSingle: 'assemblyai_api_key', localPool: 'assemblyai_api_keys_pool' },
  deepgram: { single: 'deepgram_key', pool: 'deepgram_keys_pool', localSingle: 'deepgram_api_key', localPool: 'deepgram_api_keys_pool' },
};

let inFlight: Promise<Record<string, unknown> | null> | null = null;

async function fetchRow(): Promise<Record<string, unknown> | null> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) return null;
      const { data } = await supabase
        .from('user_api_keys')
        .select('*')
        .eq('user_identifier', uid)
        .maybeSingle();
      return (data as Record<string, unknown> | null) ?? null;
    } catch (err) {
      debugLog.error('CloudKeyFallback', `Failed to fetch keys: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      setTimeout(() => { inFlight = null; }, 2000);
    }
  })();
  return inFlight;
}

/** Fetch a provider's keys straight from the cloud and restore them locally. */
export async function recoverProviderKeysFromCloud(provider: string): Promise<string[]> {
  const map = columnMap[provider];
  if (!map) return [];
  const row = await fetchRow();
  if (!row) return [];

  const single = typeof row[map.single] === 'string' ? (row[map.single] as string).trim() : '';
  const poolRaw = row[map.pool];
  const pool = Array.isArray(poolRaw)
    ? (poolRaw as unknown[]).map((k) => String(k).trim()).filter(Boolean)
    : [];

  if (single) await setEncryptedKey(map.localSingle, single);
  if (pool.length) localStorage.setItem(map.localPool, JSON.stringify(pool));

  const merged = [...pool];
  if (single && !merged.includes(single)) merged.unshift(single);
  const keys = Array.from(new Set(merged));
  if (keys.length) debugLog.info('CloudKeyFallback', `Recovered ${keys.length} ${provider} key(s) from cloud ✓`);
  return keys;
}

/**
 * Restore the canonical Gemini key on demand. The dedicated Gemini field wins,
 * while the existing Google AI key remains a valid fallback for users who
 * configured only the shared Google/Gemini credential.
 */
export async function recoverGeminiKeyFromCloud(): Promise<string> {
  const row = await fetchRow();
  if (!row) return '';

  const dedicated = typeof row.gemini_key === 'string' ? row.gemini_key.trim() : '';
  const google = typeof row.google_key === 'string' ? row.google_key.trim() : '';
  const key = dedicated || google;
  if (!key) return '';

  localStorage.setItem('gemini_api_key', key);
  if (localStorage.getItem('use_personal_gemini') === null) {
    localStorage.setItem('use_personal_gemini', '1');
  }
  debugLog.info('CloudKeyFallback', `Recovered Gemini key from ${dedicated ? 'dedicated' : 'Google'} cloud field ✓`);
  return key;
}
