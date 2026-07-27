import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  type DesignOverride,
  loadOverrides,
  saveOverrides,
  applyOverridesToDom,
  initDesignOverrides,
} from '@/lib/designOverrides';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface Ctx {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  overrides: DesignOverride[];
  addOverride: (o: Omit<DesignOverride, 'id' | 'createdAt'>) => void;
  undoLast: () => void;
  clearAll: () => void;
}

const DesignModeContext = createContext<Ctx | null>(null);

export function DesignModeProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [overrides, setOverrides] = useState<DesignOverride[]>([]);
  const { user } = useAuth();

  useEffect(() => {
    initDesignOverrides();
    setOverrides(loadOverrides());

    const params = new URLSearchParams(window.location.search);
    if (params.get('designMode') === '1') {
      setEnabled(true);
    }
  }, []);

  // Pull cloud-saved global overrides once user is known. Last-write-wins by createdAt.
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const { data, error } = await (supabase.from('user_preferences') as any)
          .select('design_overrides')
          .eq('user_id', user.id)
          .maybeSingle();
        if (error || !data) return;
        const cloud = Array.isArray(data.design_overrides) ? data.design_overrides as DesignOverride[] : [];
        if (cloud.length === 0) return;
        const local = loadOverrides();
        const cloudMax = Math.max(0, ...cloud.map(o => o.createdAt || 0));
        const localMax = Math.max(0, ...local.map(o => o.createdAt || 0));
        if (cloudMax > localMax) {
          saveOverrides(cloud);
          setOverrides(cloud);
        }
      } catch (e) { console.warn('[design-mode] cloud fetch failed', e); }
    })();
  }, [user?.id]);

  // Toggle body class for cursor + disable interactions
  useEffect(() => {
    document.body.classList.toggle('design-mode-active', enabled);
    return () => document.body.classList.remove('design-mode-active');
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('designMode') !== '1') {
      params.set('designMode', '1');
      const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
      window.history.replaceState({}, '', next);
    }
  }, [enabled]);

  const persist = (next: DesignOverride[]) => {
    setOverrides(next);
    saveOverrides(next);
  };

  const addOverride = useCallback((o: Omit<DesignOverride, 'id' | 'createdAt'>) => {
    const next = [...overrides, { ...o, id: crypto.randomUUID(), createdAt: Date.now() }];
    persist(next);
  }, [overrides]);

  const undoLast = useCallback(() => {
    if (overrides.length === 0) return;
    persist(overrides.slice(0, -1));
  }, [overrides]);

  const clearAll = useCallback(() => {
    persist([]);
    applyOverridesToDom([]);
  }, []);

  return (
    <DesignModeContext.Provider value={{ enabled, setEnabled, overrides, addOverride, undoLast, clearAll }}>
      {children}
    </DesignModeContext.Provider>
  );
}

export function useDesignMode() {
  const c = useContext(DesignModeContext);
  if (!c) throw new Error('useDesignMode must be used within DesignModeProvider');
  return c;
}
