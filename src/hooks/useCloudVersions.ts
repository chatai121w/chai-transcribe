import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { debugLog } from '@/lib/debugLogger';
import { db, isDbAvailable } from '@/lib/localDb';
import type { LocalVersion } from '@/lib/localDb';

export interface CloudVersion {
  id: string;
  transcript_id: string;
  user_id: string;
  text: string;
  source: string;
  engine_label: string | null;
  action_label: string | null;
  version_number: number;
  word_count: number | null;
  created_at: string;
}

export const useCloudVersions = (transcriptId: string | null) => {
  const { user } = useAuth();
  const [versions, setVersions] = useState<CloudVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchVersions = useCallback(async () => {
    if (!transcriptId || !user) return;
    setIsLoading(true);
    try {
      // 1) Local first
      if (await isDbAvailable()) {
        const local = await db.versions
          .where('transcript_id')
          .equals(transcriptId)
          .sortBy('version_number');
        if (local.length > 0) {
          setVersions(local.map(l => ({
            id: l.id,
            transcript_id: l.transcript_id,
            user_id: l.user_id,
            text: l.text,
            source: l.source,
            engine_label: l.engine_label ?? null,
            action_label: l.action_label ?? null,
            version_number: l.version_number,
            word_count: null,
            created_at: l.created_at,
          })));
        }
      }

      // 2) Cloud
      const { data, error } = await (supabase
        .from('transcript_versions' as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .select('*')
        .eq('transcript_id', transcriptId)
        .order('version_number', { ascending: true }) as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      if (error) throw error;
      const cloud = (data || []) as CloudVersion[];
      setVersions(cloud);

      // Sync to local
      if (await isDbAvailable() && cloud.length > 0) {
        const toSync: LocalVersion[] = cloud.map(v => ({
          id: v.id,
          transcript_id: v.transcript_id,
          user_id: v.user_id,
          text: v.text,
          source: v.source,
          engine_label: v.engine_label,
          action_label: v.action_label,
          version_number: v.version_number,
          created_at: v.created_at,
          _dirty: false,
        }));
        await db.versions.bulkPut(toSync);
      }
      debugLog.info('Versions', `Loaded ${cloud.length} versions for transcript ${transcriptId}`);
    } catch (err) {
      debugLog.error('Versions', 'Error fetching versions', err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [transcriptId, user]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const saveVersion = useCallback(async (
    text: string,
    source: string,
    engineLabel?: string | null,
    actionLabel?: string | null,
  ): Promise<CloudVersion | null> => {
    if (!transcriptId || !user) return null;

    const nextNumber = versions.length > 0
      ? Math.max(...versions.map(v => v.version_number)) + 1
      : 1;

    const localId = crypto.randomUUID();
    const now = new Date().toISOString();
    const localVersion: LocalVersion = {
      id: localId,
      transcript_id: transcriptId,
      user_id: user.id,
      text,
      source,
      engine_label: engineLabel || null,
      action_label: actionLabel || null,
      version_number: nextNumber,
      created_at: now,
      _dirty: true,
    };

    // Optimistic local update
    const optimistic: CloudVersion = {
      id: localId,
      transcript_id: transcriptId,
      user_id: user.id,
      text,
      source,
      engine_label: engineLabel || null,
      action_label: actionLabel || null,
      version_number: nextNumber,
      word_count: null,
      created_at: now,
    };
    setVersions(prev => [...prev, optimistic]);

    // Save to local DB
    if (await isDbAvailable()) {
      await db.versions.put(localVersion);
    }

    try {
      const { data, error } = await (supabase
        .from('transcript_versions' as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .insert({
          transcript_id: transcriptId,
          user_id: user.id,
          text,
          source,
          engine_label: engineLabel || null,
          action_label: actionLabel || null,
          version_number: nextNumber,
        })
        .select()
        .single() as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      if (error) throw error;
      const cloudVersion = data as CloudVersion;

      // Replace optimistic with cloud version
      setVersions(prev => prev.map(v => v.id === localId ? cloudVersion : v));

      // Update local DB with cloud ID
      if (await isDbAvailable()) {
        await db.versions.delete(localId);
        await db.versions.put({
          ...localVersion,
          id: cloudVersion.id,
          _dirty: false,
        });
      }

      debugLog.info('Versions', `Saved version #${nextNumber} (${source}) to cloud`);
      return cloudVersion;
    } catch (err) {
      debugLog.error('Versions', 'Error saving version to cloud', err instanceof Error ? err.message : String(err));
      // Local version is still saved — will sync later
      return optimistic;
    }
  }, [transcriptId, user, versions]);

  return { versions, isLoading, saveVersion, refetch: fetchVersions };
};
