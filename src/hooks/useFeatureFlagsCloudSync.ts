/**
 * Feature flags cloud sync.
 *
 * Persists every toggle from /features (or any FeatureToggleChip) to the
 * `feature_flags` JSONB column on user_preferences, and applies remote
 * changes via realtime. This is what makes "turn off" actually stick across
 * reloads and devices.
 */
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  FEATURE_FLAGS,
  readFlag,
  writeFlag,
  snapshotAllFlags,
} from '@/lib/featureFlags';
import { debugLog } from '@/lib/debugLogger';

const DEBOUNCE_MS = 800;
const META_TS_KEY = '__updatedAt';

type RemoteFlags = Record<string, boolean | number | undefined> & {
  [META_TS_KEY]?: number;
};

export function useFeatureFlagsCloudSync(): void {
  const { user } = useAuth();
  const lastLocalChangeRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressPushRef = useRef<boolean>(false);

  // ── Initial load + realtime ──
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const applyRemote = (remote: RemoteFlags | null | undefined) => {
      if (!remote || typeof remote !== 'object') return;
      suppressPushRef.current = true;
      try {
        for (const f of FEATURE_FLAGS) {
          const v = remote[f.key];
          if (typeof v === 'boolean') {
            const current = readFlag(f.key);
            if (current !== v) writeFlag(f.key, v, { silent: true });
          }
        }
      } finally {
        // Release on next microtask so the dispatched events have flushed.
        setTimeout(() => { suppressPushRef.current = false; }, 0);
      }
    };

    const load = async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('feature_flags, updated_at')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq('user_id', user.id as any)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        debugLog.warn('FlagsSync', 'load failed', { msg: error.message });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const remote = ((data as any)?.feature_flags ?? null) as RemoteFlags | null;
      const remoteTs = Number(remote?.[META_TS_KEY] ?? 0);

      // Find newest local timestamp across all flag keys
      let localTs = 0;
      for (const f of FEATURE_FLAGS) {
        const t = Number(localStorage.getItem(`${f.key}__updated_at`) || 0);
        if (t > localTs) localTs = t;
      }

      if (remote && remoteTs >= localTs) {
        applyRemote(remote);
      } else if (localTs > 0 || !remote) {
        // Push local snapshot so the column gets seeded / catches up
        pushToCloud();
      }
    };

    load();

    const channel = supabase
      .channel(`feature_flags:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${user.id}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const remote = payload?.new?.feature_flags as RemoteFlags | null;
          if (!remote) return;
          // Ignore echoes of our own writes
          if (Date.now() - lastLocalChangeRef.current < 1500) return;
          applyRemote(remote);
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

    const onChange = (e: Event) => {
      if (!(e instanceof CustomEvent)) return;
      if (suppressPushRef.current) return;
      if (e.detail?.silent) return;
      lastLocalChangeRef.current = Date.now();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(pushToCloud, DEBOUNCE_MS);
    };

    window.addEventListener('featureFlagChange', onChange);
    return () => {
      window.removeEventListener('featureFlagChange', onChange);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [user]);

  async function pushToCloud() {
    if (!user) return;
    const bundle: RemoteFlags = { ...snapshotAllFlags(), [META_TS_KEY]: Date.now() };
    const { error } = await supabase
      .from('user_preferences')
      .upsert({
        user_id: user.id,
        feature_flags: bundle,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: 'user_id' });
    if (error) debugLog.warn('FlagsSync', 'push failed', { msg: error.message });
    else debugLog.info('FlagsSync', 'pushed', { keys: Object.keys(bundle).length - 1 });
  }
}
