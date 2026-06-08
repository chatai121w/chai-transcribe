import { useEffect, useCallback, useMemo, useSyncExternalStore } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { debugLog } from '@/lib/debugLogger';
import { db, isDbAvailable } from '@/lib/localDb';
import {
  getLocalTranscripts,
  saveTranscriptLocally,
  updateTranscriptLocally,
  deleteTranscriptLocally,
  reconcileDeletedTranscripts,
} from '@/lib/syncEngine';

export interface CloudTranscript {
  id: string;
  user_id: string;
  text: string;
  engine: string;
  tags: string[];
  notes: string;
  title: string;
  folder: string;
  category: string;
  is_favorite: boolean;
  audio_file_path: string | null;
  /** Word-level timings for audio-sync player */
  word_timings?: Array<{word: string; start: number; end: number; probability?: number}> | null;
  /** User-edited text (original kept in `text`) */
  edited_text?: string | null;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Singleton store — shared across every component that calls useCloudTranscripts.
// Prevents duplicate fetches, duplicate realtime subscriptions, and duplicate
// re-renders that previously caused the "multiple spinners / refreshes" issue.
// ─────────────────────────────────────────────────────────────────────────

type StoreState = {
  transcripts: CloudTranscript[];
  isLoading: boolean;
};

let state: StoreState = { transcripts: [], isLoading: false };
const listeners = new Set<() => void>();

function setState(next: Partial<StoreState>) {
  state = { ...state, ...next };
  listeners.forEach(l => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function getSnapshot() {
  return state;
}

// Fetch dedup & cooldown
let activeUserId: string | null = null;
let inflightFetch: Promise<void> | null = null;
let lastFetchAt = 0;
const FETCH_COOLDOWN_MS = 4000;

function transcriptsEqual(a: CloudTranscript[], b: CloudTranscript[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].updated_at !== b[i].updated_at) return false;
  }
  return true;
}

async function doFetch(userId: string, force = false) {
  const now = Date.now();
  if (!force && now - lastFetchAt < FETCH_COOLDOWN_MS) return;
  if (inflightFetch) return inflightFetch;

  lastFetchAt = now;
  setState({ isLoading: true });

  inflightFetch = (async () => {
    try {
      // 1) Local DB first (instant)
      const local = await getLocalTranscripts(userId);
      if (local.length > 0 && !transcriptsEqual(state.transcripts, local as CloudTranscript[])) {
        setState({ transcripts: local as CloudTranscript[] });
        debugLog.info('Cloud', `Loaded ${local.length} transcripts from local DB`);
      }

      // 2) Cloud
      const { data, error } = await supabase
        .from('transcripts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      const cloud = (data as CloudTranscript[]) || [];

      if (!transcriptsEqual(state.transcripts, cloud)) {
        setState({ transcripts: cloud });
      }

      // 3) Mirror cloud → local DB
      if (await isDbAvailable()) {
        const cloudIds = new Set(cloud.map(t => t.id));
        const dirtyIds = new Set(
          (await db.transcripts.where('_dirty').equals(1).primaryKeys()).map(String)
        );
        const toSync = cloud
          .filter(t => !dirtyIds.has(t.id))
          .map(t => ({
            ...t,
            tags: t.tags || [],
            notes: t.notes || '',
            title: t.title || '',
            folder: t.folder || '',
            category: t.category || '',
            is_favorite: t.is_favorite || false,
            _dirty: false,
            _deleted: false,
          }));
        if (toSync.length > 0) {
          await db.transcripts.bulkPut(toSync);
        }
        await reconcileDeletedTranscripts(userId, cloudIds);
        debugLog.info('Cloud', `Synced ${cloud.length} transcripts to local DB`);
      }
    } catch (err) {
      debugLog.error('Cloud', 'Error fetching transcripts', err instanceof Error ? err.message : String(err));
    } finally {
      setState({ isLoading: false });
      inflightFetch = null;
    }
  })();

  return inflightFetch;
}

// Single realtime channel for the active user
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

function startRealtime(userId: string) {
  if (realtimeChannel && activeUserId === userId) return;
  stopRealtime();
  activeUserId = userId;

  realtimeChannel = supabase
    .channel(`transcripts-changes-${userId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'transcripts' },
      async (payload) => {
        const newItem = payload.new as CloudTranscript;
        if (state.transcripts.some(t => t.id === newItem.id)) return;
        setState({ transcripts: [newItem, ...state.transcripts] });
        if (await isDbAvailable()) {
          await db.transcripts.put({
            ...newItem, tags: newItem.tags || [], notes: newItem.notes || '',
            title: newItem.title || '', folder: newItem.folder || '',
            category: newItem.category || '', is_favorite: newItem.is_favorite || false,
            _dirty: false, _deleted: false,
          });
        }
      })
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'transcripts' },
      async (payload) => {
        const updated = payload.new as CloudTranscript;
        const cur = state.transcripts.find(t => t.id === updated.id);
        if (cur && cur.updated_at === updated.updated_at) return;
        setState({ transcripts: state.transcripts.map(t => t.id === updated.id ? updated : t) });
        if (await isDbAvailable()) {
          const existing = await db.transcripts.get(updated.id);
          if (!existing?._dirty) {
            await db.transcripts.put({
              ...updated, tags: updated.tags || [], notes: updated.notes || '',
              title: updated.title || '', folder: updated.folder || '',
              category: updated.category || '', is_favorite: updated.is_favorite || false,
              _dirty: false, _deleted: false,
            });
          }
        }
      })
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'transcripts' },
      async (payload) => {
        setState({ transcripts: state.transcripts.filter(t => t.id !== (payload.old as any).id) });
        if (await isDbAvailable()) {
          await db.transcripts.delete((payload.old as any).id);
        }
      })
    .subscribe();
}

function stopRealtime() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  activeUserId = null;
}

// Track how many React consumers are mounted — tear down realtime only when none remain.
let mountedCount = 0;

export const useCloudTranscripts = () => {
  const { user, isAuthenticated } = useAuth();
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Mount/unmount tracking + bootstrap fetch + realtime
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    mountedCount++;
    doFetch(user.id);
    startRealtime(user.id);
    return () => {
      mountedCount--;
      if (mountedCount <= 0) {
        mountedCount = 0;
        stopRealtime();
      }
    };
  }, [isAuthenticated, user]);

  const fetchTranscripts = useCallback(async () => {
    if (!user) return;
    await doFetch(user.id, true);
  }, [user]);

  const uploadAudioFile = useCallback(async (file: File): Promise<string | null> => {
    if (!user) return null;
    try {
      const ext = file.name.split('.').pop() || 'wav';
      const filePath = `${user.id}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}.${ext}`;
      const { error } = await supabase.storage
        .from('permanent-audio')
        .upload(filePath, file, { cacheControl: '3600', upsert: false });
      if (error) throw error;
      return filePath;
    } catch (error) {
      debugLog.error('Cloud', 'Error uploading audio', error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [user]);

  const getAudioUrl = useCallback(async (filePath: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase.storage
        .from('permanent-audio')
        .createSignedUrl(filePath, 3600);
      if (error) throw error;
      return data.signedUrl;
    } catch (error) {
      debugLog.error('Cloud', 'Error getting audio URL', error instanceof Error ? error.message : String(error));
      return null;
    }
  }, []);

  const saveTranscript = useCallback(async (
    text: string,
    engine: string,
    title?: string,
    audioFile?: File,
    wordTimings?: Array<{word: string; start: number; end: number; probability?: number}> | null,
    folder?: string
  ): Promise<CloudTranscript | null> => {
    if (!user) {
      const history = JSON.parse(localStorage.getItem('transcript_history') || '[]');
      const entry = { text, timestamp: Date.now(), engine, tags: [], notes: '', word_timings: wordTimings || null, folder: folder || '' };
      const updated = [entry, ...history].slice(0, 50);
      localStorage.setItem('transcript_history', JSON.stringify(updated));
      return null;
    }

    try {
      const autoTitle = title || text.substring(0, 60).replace(/\n/g, ' ') + '...';
      const now = new Date().toISOString();
      const localId = crypto.randomUUID();
      const localRecord = {
        id: localId,
        user_id: user.id,
        text,
        engine,
        title: autoTitle,
        tags: [] as string[],
        notes: '',
        folder: folder || '',
        category: '',
        is_favorite: false,
        audio_file_path: null as string | null,
        word_timings: wordTimings || null,
        edited_text: null as string | null,
        created_at: now,
        updated_at: now,
        audio_blob: audioFile || undefined,
      };

      await saveTranscriptLocally(localRecord);

      const { data, error } = await supabase
        .from('transcripts')
        .insert({
          user_id: user.id,
          text,
          engine,
          title: autoTitle,
          tags: [],
          notes: '',
          folder: folder || '',
          word_timings: wordTimings || null,
        })
        .select()
        .single();

      if (error) throw error;

      if (data) {
        await db.transcripts.delete(localId);
        await saveTranscriptLocally({
          ...data as CloudTranscript,
          tags: data.tags || [], notes: data.notes || '',
          title: data.title || '', folder: data.folder || '',
          category: data.category || '', is_favorite: data.is_favorite || false,
          audio_blob: audioFile || undefined,
        });
        await db.transcripts.update(data.id, { _dirty: false });

        // Optimistic insert into the store (realtime will dedupe)
        if (!state.transcripts.some(t => t.id === data.id)) {
          setState({ transcripts: [data as CloudTranscript, ...state.transcripts] });
        }
      }

      if (audioFile && data) {
        const cloudId = data.id;
        uploadAudioFile(audioFile).then(async (audioPath) => {
          if (!audioPath) return;
          await supabase.from('transcripts').update({ audio_file_path: audioPath }).eq('id', cloudId);
          if (await isDbAvailable()) {
            await db.transcripts.update(cloudId, { audio_file_path: audioPath });
          }
          debugLog.info('Cloud', `Background audio upload complete: ${audioPath}`);
        }).catch((err) => {
          debugLog.error('Cloud', 'Background audio upload failed', err instanceof Error ? err.message : String(err));
        });
      }

      return data as CloudTranscript;
    } catch (error) {
      debugLog.error('Cloud', 'Error saving transcript', error instanceof Error ? error.message : String(error));
      toast({
        title: 'שגיאה בשמירה',
        description: 'לא ניתן לשמור את התמלול בענן',
        variant: 'destructive',
      });
      return null;
    }
  }, [user, uploadAudioFile]);

  const updateTranscript = useCallback(async (
    id: string,
    updates: Partial<Pick<CloudTranscript, 'text' | 'tags' | 'notes' | 'title' | 'folder' | 'category' | 'is_favorite' | 'edited_text' | 'word_timings'>>
  ) => {
    try {
      await updateTranscriptLocally(id, updates);

      // Optimistic update in store
      setState({
        transcripts: state.transcripts.map(t =>
          t.id === id ? { ...t, ...updates, updated_at: new Date().toISOString() } as CloudTranscript : t
        ),
      });

      const { error } = await supabase
        .from('transcripts')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (!error) {
        await db.transcripts.update(id, { _dirty: false });
      }
      if (error) throw error;
    } catch (error) {
      debugLog.error('Cloud', 'Error updating transcript (saved locally)', error instanceof Error ? error.message : String(error));
    }
  }, []);

  const deleteTranscript = useCallback(async (id: string) => {
    try {
      await deleteTranscriptLocally(id);

      const transcript = state.transcripts.find(t => t.id === id);
      if (transcript?.audio_file_path) {
        await supabase.storage.from('permanent-audio').remove([transcript.audio_file_path]);
      }

      // Optimistic
      setState({ transcripts: state.transcripts.filter(t => t.id !== id) });

      const { error } = await supabase
        .from('transcripts')
        .delete()
        .eq('id', id);

      if (!error) {
        await db.transcripts.delete(id);
      }
      if (error) throw error;
    } catch (error) {
      debugLog.error('Cloud', 'Error deleting transcript', error instanceof Error ? error.message : String(error));
      toast({
        title: 'שגיאה במחיקה',
        description: 'לא ניתן למחוק את התמלול',
        variant: 'destructive',
      });
    }
  }, []);

  const deleteAll = useCallback(async () => {
    if (!user) return;
    try {
      const audioPaths = state.transcripts
        .filter(t => t.audio_file_path)
        .map(t => t.audio_file_path!);

      const { error } = await supabase
        .from('transcripts')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;

      if (audioPaths.length > 0) {
        await supabase.storage.from('permanent-audio').remove(audioPaths);
      }

      if (await isDbAvailable()) {
        await db.transcripts.where('user_id').equals(user.id).delete();
      }

      setState({ transcripts: [] });
    } catch (error) {
      debugLog.error('Cloud', 'Error deleting all transcripts', error instanceof Error ? error.message : String(error));
    }
  }, [user]);

  const stats = useMemo(() => ({
    total: snap.transcripts.length,
    engines: [...new Set(snap.transcripts.map(t => t.engine))],
    totalChars: snap.transcripts.reduce((sum, t) => sum + (t.text?.length ?? 0), 0),
  }), [snap.transcripts]);

  return {
    transcripts: snap.transcripts,
    isLoading: snap.isLoading,
    saveTranscript,
    updateTranscript,
    deleteTranscript,
    deleteAll,
    fetchTranscripts,
    getAudioUrl,
    stats,
    isCloud: isAuthenticated,
  };
};
