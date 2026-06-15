import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { syncAll } from '@/lib/syncEngine';
import { isDbAvailable } from '@/lib/localDb';
import { debugLog } from '@/lib/debugLogger';

/**
 * Background sync component — runs periodic sync between local IndexedDB and Supabase cloud.
 * Place this inside AuthProvider.
 */
export const BackgroundSync = () => {
  const { user } = useAuth();
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (!user) return;

    const runSync = async () => {
      if (!(await isDbAvailable())) return;
      try {
        await syncAll(user.id);
      } catch (err) {
        debugLog.error('BackgroundSync', 'Sync error', err instanceof Error ? err.message : String(err));
      }
    };

    // Initial sync after 2s (let UI render first)
    const initialTimer = setTimeout(runSync, 2000);

    // Periodic sync every 60s
    intervalRef.current = setInterval(runSync, 60_000);

    // Also sync when tab becomes visible
    const onVisibility = () => {
      if (document.visibilityState === 'visible') runSync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user]);

  return null;
};
