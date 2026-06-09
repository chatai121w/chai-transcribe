import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  type DesignOverride,
  loadOverrides,
  saveOverrides,
  applyOverridesToDom,
  initDesignOverrides,
} from '@/lib/designOverrides';

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

  useEffect(() => {
    initDesignOverrides();
    setOverrides(loadOverrides());
  }, []);

  // Toggle body class for cursor + disable interactions
  useEffect(() => {
    document.body.classList.toggle('design-mode-active', enabled);
    return () => document.body.classList.remove('design-mode-active');
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
