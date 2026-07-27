/**
 * Loshon Kodesh rules cloud sync.
 *
 * Reads `lk_rules` JSONB column from user_preferences on mount, merges with
 * local copy (newer wins), then debounce-pushes any local change to the cloud.
 * Subscribes to realtime updates from other devices.
 *
 * Local always wins for the first second after a local change to avoid
 * a remote echo overwriting a fresh edit.
 */
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAllLkRules,
  applyRemoteLkRules,
  subscribeLoshonKodeshRules,
  type LkRulesBundle,
} from '@/lib/loshonKodesh';
import { debugLog } from '@/lib/debugLogger';

const DEBOUNCE_MS = 1500;

export function useLoshonKodeshSync(): void {
  const { user } = useAuth();
  const lastLocalChangeRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Initial load + realtime channel ──
  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('lk_rules, updated_at')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq('user_id', user.id as any)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        debugLog.warn('LkSync', 'load failed', { msg: error.message });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const remote = (data as any)?.lk_rules as Partial<LkRulesBundle> | null;
      if (!remote) {
        // Nothing in cloud yet — push current local rules so the column gets seeded.
        pushToCloud(getAllLkRules());
        return;
      }

      const local = getAllLkRules();
      // Conflict resolution: newer wins
      if ((remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        applyRemoteLkRules(remote);
        debugLog.info('LkSync', 'applied remote rules', { remoteAt: remote.updatedAt, localAt: local.updatedAt });
      } else if ((local.updatedAt ?? 0) > (remote.updatedAt ?? 0)) {
        pushToCloud(local);
      }
    };

    load();

    // Realtime
    const channel = supabase
      .channel(`lk_rules:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${user.id}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const remote = payload?.new?.lk_rules as Partial<LkRulesBundle> | null;
          if (!remote) return;
          // Ignore remote if we changed something locally in the last second (likely an echo)
          if (Date.now() - lastLocalChangeRef.current < 1000) return;
          const local = getAllLkRules();
          if ((remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
            applyRemoteLkRules(remote);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch { /* */ }
    };
  }, [user]);

  // ── Push local changes (debounced) ──
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeLoshonKodeshRules(() => {
      lastLocalChangeRef.current = Date.now();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        pushToCloud(getAllLkRules());
      }, DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [user]);

  // ── Helper ──
  async function pushToCloud(bundle: LkRulesBundle) {
    if (!user) return;
    const { error } = await supabase
      .from('user_preferences')
       
      .upsert({
        user_id: user.id,
        lk_rules: bundle,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: 'user_id' });
    if (error) {
      debugLog.warn('LkSync', 'push failed', { msg: error.message });
    } else {
      debugLog.info('LkSync', 'pushed', { at: bundle.updatedAt });
    }
  }
}
