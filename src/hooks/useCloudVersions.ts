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
  ai_usage_event_id?: string | null;
  folder_id?: string | null;
  audio_file_path?: string | null;
}

export const useCloudVersions = (transcriptId: string | null) => {
  const { user } = useAuth();
  const [versions, setVersions] = useState<CloudVersion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchVersions = useCallback(async () => {
    if (!transcriptId || !user) return;
    setIsLoading(true);
    try {
      let localVersions: CloudVersion[] = [];
      // 1) Local first
      if (await isDbAvailable()) {
        const local = await db.versions
          .where('transcript_id')
          .equals(transcriptId)
          .sortBy('version_number');
        if (local.length > 0) {
          localVersions = local.map(l => ({
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
            ai_usage_event_id: l.ai_usage_event_id ?? null,
            folder_id: l.folder_id ?? null,
            audio_file_path: l.audio_file_path ?? null,
          }));
          setVersions(localVersions);
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
      const merged = new Map<string, CloudVersion>();
      for (const v of localVersions) merged.set(v.id, v);
      for (const v of cloud) merged.set(v.id, v);
      setVersions(Array.from(merged.values()).sort((a, b) => a.version_number - b.version_number));

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
          ai_usage_event_id: v.ai_usage_event_id ?? null,
          folder_id: v.folder_id ?? null,
          audio_file_path: v.audio_file_path ?? null,
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

  useEffect(() => {
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ transcriptId?: string }>).detail;
      if (!detail?.transcriptId || detail.transcriptId === transcriptId) fetchVersions();
    };
    window.addEventListener('ai-version-saved', onSaved as EventListener);
    return () => window.removeEventListener('ai-version-saved', onSaved as EventListener);
  }, [fetchVersions, transcriptId]);

  // Try to find the most recent matching ai_usage_event for linking
  const findMatchingUsageEventId = useCallback(async (
    actionLabel: string | null,
    engineLabel: string | null,
  ): Promise<string | null> => {
    if (!user) return null;
    try {
      const since = new Date(Date.now() - 30_000).toISOString();
      let q = (supabase
        .from('ai_usage_events' as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .select('id, model, feature, created_at')
        .eq('user_id', user.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5) as any);
      const { data } = await q;
      const rows = (data || []) as Array<{ id: string; model: string | null; feature: string | null }>;
      if (!rows.length) return null;
      // Prefer match by model
      if (engineLabel) {
        const byModel = rows.find(r => (r.model || '').includes(engineLabel) || engineLabel.includes(r.model || ''));
        if (byModel) return byModel.id;
      }
      return rows[0].id;
    } catch {
      return null;
    }
  }, [user]);

  const saveVersion = useCallback(async (
    text: string,
    source: string,
    engineLabel?: string | null,
    actionLabel?: string | null,
    options?: { audioFilePath?: string | null; folderId?: string | null; transcriptId?: string | null },
  ): Promise<CloudVersion | null> => {
    const targetTranscriptId = options?.transcriptId || transcriptId;
    if (!targetTranscriptId || !user) return null;

    const nextNumber = versions.length > 0
      ? Math.max(...versions.map(v => v.version_number)) + 1
      : 1;

    const localId = crypto.randomUUID();
    const now = new Date().toISOString();
    const localVersion: LocalVersion = {
      id: localId,
      transcript_id: targetTranscriptId,
      user_id: user.id,
      text,
      source,
      engine_label: engineLabel || null,
      action_label: actionLabel || null,
      version_number: nextNumber,
      created_at: now,
      audio_file_path: options?.audioFilePath ?? null,
      folder_id: options?.folderId ?? null,
      _dirty: true,
    };

    // Optimistic local update
    const optimistic: CloudVersion = {
      id: localId,
      transcript_id: targetTranscriptId,
      user_id: user.id,
      text,
      source,
      engine_label: engineLabel || null,
      action_label: actionLabel || null,
      version_number: nextNumber,
      word_count: null,
      created_at: now,
      audio_file_path: options?.audioFilePath ?? null,
      folder_id: options?.folderId ?? null,
      ai_usage_event_id: null,
    };
    setVersions(prev => [...prev, optimistic]);

    if (await isDbAvailable()) {
      await db.versions.put(localVersion);
    }

    try {
      // Best-effort link to most-recent matching ai_usage_event
      const usageEventId = await findMatchingUsageEventId(actionLabel || null, engineLabel || null);

      const insertPayload: Record<string, unknown> = {
        transcript_id: targetTranscriptId,
        user_id: user.id,
        text,
        source,
        engine_label: engineLabel || null,
        action_label: actionLabel || null,
        version_number: nextNumber,
        ai_usage_event_id: usageEventId,
        folder_id: options?.folderId ?? null,
        audio_file_path: options?.audioFilePath ?? null,
      };

      const { data, error } = await (supabase
        .from('transcript_versions' as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .insert(insertPayload)
        .select()
        .single() as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      if (error) throw error;
      const cloudVersion = data as CloudVersion;

      setVersions(prev => prev.map(v => v.id === localId ? cloudVersion : v));

      if (await isDbAvailable()) {
        await db.versions.delete(localId);
        await db.versions.put({
          ...localVersion,
          id: cloudVersion.id,
          ai_usage_event_id: cloudVersion.ai_usage_event_id ?? null,
          _dirty: false,
        });
      }

      debugLog.info('Versions', `Saved version #${nextNumber} (${source})`);
      try {
        window.dispatchEvent(new CustomEvent('ai-version-saved', { detail: { transcriptId: targetTranscriptId } }));
      } catch { /* noop */ }
      return cloudVersion;
    } catch (err) {
      debugLog.error('Versions', 'Error saving version to cloud', err instanceof Error ? err.message : String(err));
      return optimistic;
    }
  }, [transcriptId, user, versions, findMatchingUsageEventId]);

  const assignVersionsToFolder = useCallback(async (
    versionIds: string[],
    folderId: string | null,
    audioFilePath?: string | null,
  ): Promise<void> => {
    if (!user || versionIds.length === 0) return;
    const patch: Record<string, unknown> = { folder_id: folderId };
    if (audioFilePath !== undefined) patch.audio_file_path = audioFilePath;
    try {
      const { error } = await (supabase
        .from('transcript_versions' as any) // eslint-disable-line @typescript-eslint/no-explicit-any
        .update(patch)
        .in('id', versionIds) as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (error) throw error;
      setVersions(prev => prev.map(v => versionIds.includes(v.id)
        ? { ...v, folder_id: folderId, audio_file_path: audioFilePath ?? v.audio_file_path }
        : v));
      if (await isDbAvailable()) {
        for (const id of versionIds) {
          const existing = await db.versions.get(id);
          if (existing) {
            await db.versions.put({
              ...existing,
              folder_id: folderId,
              audio_file_path: audioFilePath ?? existing.audio_file_path,
            });
          }
        }
      }
    } catch (err) {
      debugLog.error('Versions', 'Failed to assign folder', err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [user]);

  const deleteVersion = useCallback(async (id: string): Promise<void> => {
    setVersions(prev => prev.filter(v => v.id !== id));
    try {
      await (supabase.from('transcript_versions' as any).delete().eq('id', id) as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (await isDbAvailable()) await db.versions.delete(id);
    } catch (err) {
      debugLog.error('Versions', 'Failed to delete version', err instanceof Error ? err.message : String(err));
    }
  }, []);

  const saveVersionToLocalOnly = useCallback(async (v: CloudVersion): Promise<void> => {
    if (!(await isDbAvailable())) return;
    await db.versions.put({
      id: v.id,
      transcript_id: v.transcript_id,
      user_id: v.user_id,
      text: v.text,
      source: v.source,
      engine_label: v.engine_label,
      action_label: v.action_label,
      version_number: v.version_number,
      created_at: v.created_at,
      ai_usage_event_id: v.ai_usage_event_id ?? null,
      folder_id: v.folder_id ?? null,
      audio_file_path: v.audio_file_path ?? null,
      _dirty: false,
    });
  }, []);

  return {
    versions,
    isLoading,
    saveVersion,
    assignVersionsToFolder,
    deleteVersion,
    saveVersionToLocalOnly,
    refetch: fetchVersions,
  };
};
