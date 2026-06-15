/**
 * סנכרון סל השוואת A/B בענן.
 *
 * נשמר בעמודה `ab_compare_cart_json` ב-user_preferences.
 * טוען מהענן בהתחברות, מקבל עדכוני realtime, ודוחף שינויים מקומיים (debounced).
 */
import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { abCart, type ABCartItem } from '@/lib/abCompareCart';
import { debugLog } from '@/lib/debugLogger';

const DEBOUNCE_MS = 800;

function normalize(arr: unknown): ABCartItem[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is ABCartItem =>
      x && typeof x === 'object' &&
      typeof (x as any).id === 'string' &&
      typeof (x as any).label === 'string' &&
      typeof (x as any).text === 'string'
    )
    .map((x) => ({
      id: x.id,
      label: x.label,
      text: x.text,
      addedAt: typeof x.addedAt === 'number' ? x.addedAt : Date.now(),
    }));
}

export function useABCompareCartCloudSync(): void {
  const { user } = useAuth();
  const suppressPushRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const applyRemote = (remote: unknown) => {
      const items = normalize(remote);
      suppressPushRef.current = true;
      try {
        abCart.replaceAll(items, { silent: true });
      } finally {
        setTimeout(() => { suppressPushRef.current = false; }, 0);
      }
    };

    const pushToCloud = async () => {
      try {
        const items = abCart.list();
        const { error } = await supabase
          .from('user_preferences')
          .upsert(
            { user_id: user.id, ab_compare_cart_json: items as any } as any,
            { onConflict: 'user_id' }
          );
        if (error) debugLog.warn('ABCartCloudSync', 'upsert error', error);
      } catch (e) {
        debugLog.warn('ABCartCloudSync', 'push failed', e);
      }
    };

    // Initial load
    (async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('ab_compare_cart_json')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .eq('user_id', user.id as any)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        debugLog.warn('ABCartCloudSync', 'load error', error);
        return;
      }
      const remote = (data as any)?.ab_compare_cart_json;
      if (remote != null) {
        applyRemote(remote);
      } else if (abCart.count() > 0) {
        // Cloud empty but local has items — push local up
        pushToCloud();
      }
    })();

    // Local changes → debounced push
    const unsub = abCart.subscribe((silent) => {
      if (silent || suppressPushRef.current) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(pushToCloud, DEBOUNCE_MS);
    });

    // Realtime remote updates
    const channel = supabase
      .channel(`ab_cart:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const remote = (payload.new as any)?.ab_compare_cart_json;
          if (remote != null) applyRemote(remote);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      unsub();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [user]);
}
