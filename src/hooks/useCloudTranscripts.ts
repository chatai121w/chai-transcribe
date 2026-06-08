import { useEffect, useCallback, useMemo, useSyncExternalStore, useRef } from 'react';
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
  syncTranscriptsDown,
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

export const useCloudTranscripts = () => {
  const { user, isAuthenticated } = useAuth();
  const [transcripts, setTranscripts] = useState<CloudTranscript[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchTranscripts = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      // 1) Load from local DB first (instant)
      const local = await getLocalTranscripts(user.id);
      if (local.length > 0) {
        setTranscripts(local as CloudTranscript[]);
        debugLog.info('Cloud', `Loaded ${local.length} transcripts from local DB`);
      }

      // 2) Fetch from cloud in background
      const { data, error } = await supabase
        .from('transcripts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      const cloud = (data as CloudTranscript[]) || [];
      setTranscripts(cloud);

      // 3) Write cloud data to local DB for next time
      if (await isDbAvailable()) {
        const cloudIds = new Set(cloud.map(t => t.id));
        // Get dirty local records to skip overwriting
        const dirtyIds = new Set(
          (await db.transcripts.where('_dirty').equals(1).primaryKeys())
            .map(String)
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
        await reconcileDeletedTranscripts(user.id, cloudIds);
        debugLog.info('Cloud', `Synced ${cloud.length} transcripts to local DB`);
      }
    } catch (error) {
      debugLog.error('Cloud', 'Error fetching transcripts', error instanceof Error ? error.message : String(error));
      // On cloud failure, local data is already shown — no need to clear
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTranscripts();
    }
  }, [isAuthenticated, fetchTranscripts]);

  // Realtime subscription
  useEffect(() => {
    if (!isAuthenticated) return;

    const channel = supabase
      .channel(`transcripts-changes-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'transcripts' },
        async (payload) => {
          const newItem = payload.new as CloudTranscript;
          setTranscripts(prev => [newItem, ...prev]);
          // Sync to local DB
          if (await isDbAvailable()) {
            await db.transcripts.put({
              ...newItem, tags: newItem.tags || [], notes: newItem.notes || '',
              title: newItem.title || '', folder: newItem.folder || '',
              category: newItem.category || '', is_favorite: newItem.is_favorite || false,
              _dirty: false, _deleted: false,
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'transcripts' },
        async (payload) => {
          const updated = payload.new as CloudTranscript;
          setTranscripts(prev => prev.map(t => t.id === updated.id ? updated : t));
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
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'transcripts' },
        async (payload) => {
          setTranscripts(prev => prev.filter(t => t.id !== payload.old.id));
          if (await isDbAvailable()) {
            await db.transcripts.delete(payload.old.id);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAuthenticated, fetchTranscripts]);

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
        .createSignedUrl(filePath, 3600); // 1 hour
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
        // Cache audio blob locally for offline playback
        audio_blob: audioFile || undefined,
      };

      // ① Save to local DB INSTANTLY (text + wordTimings + audio blob)
      await saveTranscriptLocally(localRecord);

      // ② Insert text + wordTimings to Supabase (NO audio upload — instant)
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

      // Update local DB with cloud ID
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
      }

      // ③ BACKGROUND: upload audio file, then update audio_file_path
      if (audioFile && data) {
        const cloudId = data.id;
        uploadAudioFile(audioFile).then(async (audioPath) => {
          if (!audioPath) return;
          // Update Supabase
          await supabase.from('transcripts').update({ audio_file_path: audioPath }).eq('id', cloudId);
          // Update local DB
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
      // Update local DB first
      await updateTranscriptLocally(id, updates);

      const { error } = await supabase
        .from('transcripts')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (!error) {
        // Cloud succeeded — clear dirty flag
        await db.transcripts.update(id, { _dirty: false });
      }
      if (error) throw error;
    } catch (error) {
      debugLog.error('Cloud', 'Error updating transcript (saved locally)', error instanceof Error ? error.message : String(error));
    }
  }, []);

  const deleteTranscript = useCallback(async (id: string) => {
    try {
      // Mark deleted locally first
      await deleteTranscriptLocally(id);

      // Delete associated audio file if exists
      const transcript = transcripts.find(t => t.id === id);
      if (transcript?.audio_file_path) {
        await supabase.storage.from('permanent-audio').remove([transcript.audio_file_path]);
      }

      const { error } = await supabase
        .from('transcripts')
        .delete()
        .eq('id', id);

      if (!error) {
        // Cloud delete succeeded — remove from local DB entirely
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
  }, [transcripts]);

  const deleteAll = useCallback(async () => {
    if (!user) return;
    try {
      // Collect audio file paths before deleting records
      const audioPaths = transcripts
        .filter(t => t.audio_file_path)
        .map(t => t.audio_file_path!);

      const { error } = await supabase
        .from('transcripts')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;

      // Delete audio files from storage
      if (audioPaths.length > 0) {
        await supabase.storage.from('permanent-audio').remove(audioPaths);
      }

      // Clear local DB too
      if (await isDbAvailable()) {
        await db.transcripts.where('user_id').equals(user.id).delete();
      }

      setTranscripts([]);
    } catch (error) {
      debugLog.error('Cloud', 'Error deleting all transcripts', error instanceof Error ? error.message : String(error));
    }
  }, [user, transcripts]);

  // Stats (memoized to prevent unnecessary re-renders)
  const stats = useMemo(() => ({
    total: transcripts.length,
    engines: [...new Set(transcripts.map(t => t.engine))],
    totalChars: transcripts.reduce((sum, t) => sum + (t.text?.length ?? 0), 0),
  }), [transcripts]);

  return {
    transcripts,
    isLoading,
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
