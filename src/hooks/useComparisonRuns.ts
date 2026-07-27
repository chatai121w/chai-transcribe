import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listRuns, groupByRecording, type ComparisonRun, type RecordingGroup,
} from '@/lib/comparisonRuns';
import { supabase } from '@/integrations/supabase/client';

export function useComparisonRuns() {
  const [runs, setRuns] = useState<ComparisonRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listRuns(500);
      setRuns(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Lightweight realtime — refresh whenever the table changes for this user
    const ch = supabase
      .channel('comparison_runs_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'comparison_runs' },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [refresh]);

  const groups = useMemo<RecordingGroup[]>(() => groupByRecording(runs), [runs]);

  return { runs, groups, loading, error, refresh };
}
