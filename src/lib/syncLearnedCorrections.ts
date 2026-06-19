/**
 * Sync the locally learned ASR corrections dictionary to the cloud.
 *
 * Local store: localStorage `transcription_corrections` (utils/correctionLearning).
 * Cloud table: public.asr_learned_corrections (one row per user × original × corrected).
 *
 * Strategy: bidirectional merge — pull cloud rows, merge with local using
 * (max frequency, max confidence, latest lastUsed), persist merged back to
 * local, push merged rows to cloud via upsert.
 */

import { supabase } from '@/integrations/supabase/client';
import type { CorrectionEntry } from '@/utils/correctionLearning';

const LOCAL_KEY = 'transcription_corrections';
const LAST_SYNC_KEY = 'asr_learned_corrections_last_sync';

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

export interface SyncResult {
  pushed: number;
  pulled: number;
  total: number;
  at: number;
}

function loadLocal(): CorrectionEntry[] {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); }
  catch { return []; }
}

function saveLocal(entries: CorrectionEntry[]): void {
  const sorted = entries
    .sort((a, b) => (b.confidence * b.frequency) - (a.confidence * a.frequency))
    .slice(0, 2000);
  localStorage.setItem(LOCAL_KEY, JSON.stringify(sorted));
}

function keyOf(e: { original: string; corrected: string }): string {
  return `${e.original}\u0001${e.corrected}`;
}

export function getLastSyncAt(): number | null {
  const raw = localStorage.getItem(LAST_SYNC_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull cloud rows + push local rows in a single merge.
 * Returns counts. If no authenticated user, returns counts of 0.
 */
export async function syncLearnedCorrections(userId: string | null | undefined): Promise<SyncResult> {
  const now = Date.now();
  if (!userId) {
    return { pushed: 0, pulled: 0, total: loadLocal().length, at: now };
  }

  // 1) Pull
  const { data: cloudRows, error: pullErr } = await (supabase as any)
    .from('asr_learned_corrections')
    .select('original,corrected,note,frequency,confidence,engine,category,last_used,created_at')
    .eq('user_id', userId)
    .limit(2000);

  if (pullErr) throw pullErr;

  const cloud: CorrectionEntry[] = (cloudRows || []).map((r: any) => ({
    original: r.original,
    corrected: r.corrected,
    note: r.note ?? undefined,
    frequency: Number(r.frequency) || 1,
    confidence: Number(r.confidence) || 0.5,
    engine: r.engine || 'manual',
    category: (r.category as CorrectionEntry['category']) || 'word',
    lastUsed: r.last_used ? new Date(r.last_used).getTime() : now,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : now,
  }));

  // 2) Merge with local
  const local = loadLocal();
  const merged = new Map<string, CorrectionEntry>();
  for (const e of local) merged.set(keyOf(e), { ...e });
  let pulled = 0;
  for (const c of cloud) {
    const k = keyOf(c);
    const ex = merged.get(k);
    if (!ex) { merged.set(k, c); pulled += 1; continue; }
    merged.set(k, {
      ...ex,
      frequency: Math.max(ex.frequency || 0, c.frequency || 0) || 1,
      confidence: Math.max(ex.confidence || 0, c.confidence || 0),
      lastUsed: Math.max(ex.lastUsed || 0, c.lastUsed || 0) || now,
      createdAt: Math.min(ex.createdAt || now, c.createdAt || now) || now,
      note: ex.note || c.note,
      engine: ex.engine || c.engine,
      category: ex.category || c.category,
    });
  }

  const mergedList = Array.from(merged.values());
  saveLocal(mergedList);

  // 3) Push entries that differ from cloud (or are new)
  const cloudByKey = new Map(cloud.map((c) => [keyOf(c), c] as const));
  const toPush = mergedList.filter((m) => {
    const c = cloudByKey.get(keyOf(m));
    if (!c) return true;
    return (
      (m.frequency || 0) !== (c.frequency || 0) ||
      (m.confidence || 0) !== (c.confidence || 0) ||
      (m.lastUsed || 0) > (c.lastUsed || 0) ||
      (m.note || '') !== (c.note || '')
    );
  });

  let pushed = 0;
  if (toPush.length > 0) {
    // chunk to keep payloads reasonable
    const chunkSize = 250;
    for (let i = 0; i < toPush.length; i += chunkSize) {
      const slice = toPush.slice(i, i + chunkSize);
      const rows = slice.map((e) => ({
        user_id: userId,
        original: e.original,
        corrected: e.corrected,
        note: e.note ?? null,
        frequency: e.frequency || 1,
        confidence: e.confidence ?? 0.5,
        engine: e.engine || 'manual',
        category: e.category || 'word',
        last_used: new Date(e.lastUsed || now).toISOString(),
      }));
      const { error: upErr } = await (supabase as any)
        .from('asr_learned_corrections')
        .upsert(rows, { onConflict: 'user_id,original,corrected', ignoreDuplicates: false });
      if (upErr) throw upErr;
      pushed += rows.length;
    }
  }

  localStorage.setItem(LAST_SYNC_KEY, String(now));
  return { pushed, pulled, total: mergedList.length, at: now };
}
