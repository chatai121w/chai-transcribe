import { useCallback, useEffect, useRef, useState } from 'react';
import { debugLog } from '@/lib/debugLogger';
import { toast } from '@/hooks/use-toast';

export interface QueueItem {
  id: string;
  fileName: string;
  fileSize: number;
  audioUrl: string;
  addedAt: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

const DB_NAME = 'transcriber_queue';
const DB_VERSION = 1;
const STORE_FILES = 'files';     // blob storage
const STORE_META = 'meta';       // QueueItem metadata

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES);
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut<T>(storeName: string, key: string, value: T): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    if (storeName === STORE_META) {
      // Meta store uses keyPath 'id' — value is the full object
      tx.objectStore(storeName).put(value);
    } else {
      tx.objectStore(storeName).put(value, key);
    }
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function dbGet<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result as T | undefined); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function dbDelete(storeName: string, key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function dbGetAllMeta(): Promise<QueueItem[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).getAll();
    req.onsuccess = () => { db.close(); resolve(req.result as QueueItem[]); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/**
 * Persistent local transcription queue backed by IndexedDB.
 * Files survive page refresh and auto-process when the CUDA server comes up.
 */
export function useLocalTranscriptionQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const processingRef = useRef(false);

  // Load queue from IndexedDB on mount
  useEffect(() => {
    dbGetAllMeta().then(items => {
      // Reset any "processing" items back to "pending" (page was refreshed mid-job)
      const restored = items.map(item =>
        item.status === 'processing' ? { ...item, status: 'pending' as const } : item
      );
      setQueue(restored.sort((a, b) => a.addedAt - b.addedAt));
      if (restored.length > 0) {
        debugLog.info('Queue', `Restored ${restored.length} pending transcription(s) from IndexedDB`);
      }
    }).catch(err => {
      debugLog.error('Queue', 'Failed to load queue from IndexedDB', err);
    });
  }, []);

  const addToQueue = useCallback(async (file: File, audioUrl: string): Promise<string> => {
    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const item: QueueItem = {
      id,
      fileName: file.name,
      fileSize: file.size,
      audioUrl,
      addedAt: Date.now(),
      status: 'pending',
    };

    // Store file blob and metadata in IndexedDB
    await dbPut(STORE_FILES, id, file);
    await dbPut(STORE_META, id, item);

    // Verify the file was actually persisted
    const verify = await dbGet<File>(STORE_FILES, id);
    if (!verify) {
      toast({ title: "שגיאה בשמירת קובץ", description: "הקובץ לא נשמר ב-IndexedDB", variant: "destructive" });
      throw new Error('File not persisted to IndexedDB');
    }

    setQueue(prev => [...prev, item]);
    debugLog.info('Queue', `Added to queue: ${file.name} (${id}) — verified in IndexedDB`);
    return id;
  }, []);

  const removeFromQueue = useCallback(async (id: string) => {
    await dbDelete(STORE_FILES, id).catch(() => {});
    await dbDelete(STORE_META, id).catch(() => {});
    setQueue(prev => prev.filter(item => item.id !== id));
    debugLog.info('Queue', `Removed from queue: ${id}`);
  }, []);

  const updateItemStatus = useCallback(async (id: string, status: QueueItem['status'], error?: string) => {
    setQueue(prev => prev.map(item =>
      item.id === id ? { ...item, status, error } : item
    ));
    // Update metadata in IndexedDB
    const meta = await dbGet<QueueItem>(STORE_META, id);
    if (meta) {
      await dbPut(STORE_META, id, { ...meta, status, error });
    }
  }, []);

  const getFile = useCallback(async (id: string): Promise<File | null> => {
    const blob = await dbGet<File>(STORE_FILES, id);
    return blob || null;
  }, []);

  /** Get the next pending item (FIFO) */
  const getNextPending = useCallback((): QueueItem | null => {
    return queue.find(item => item.status === 'pending') || null;
  }, [queue]);

  const pendingCount = queue.filter(item => item.status === 'pending').length;
  const processingItem = queue.find(item => item.status === 'processing') || null;

  const clearCompleted = useCallback(async () => {
    const completed = queue.filter(item => item.status === 'completed' || item.status === 'failed');
    for (const item of completed) {
      await dbDelete(STORE_FILES, item.id).catch(() => {});
      await dbDelete(STORE_META, item.id).catch(() => {});
    }
    setQueue(prev => prev.filter(item => item.status !== 'completed' && item.status !== 'failed'));
  }, [queue]);

  /** Reset a failed item back to pending so it will be retried */
  const retryItem = useCallback(async (id: string) => {
    await updateItemStatus(id, 'pending', undefined);
    debugLog.info('Queue', `Retried item: ${id}`);
  }, [updateItemStatus]);

  /** Create a temporary playback URL for a queued item's audio */
  const getPlaybackUrl = useCallback(async (id: string): Promise<string | null> => {
    const file = await getFile(id);
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [getFile]);

  return {
    queue,
    pendingCount,
    processingItem,
    addToQueue,
    removeFromQueue,
    updateItemStatus,
    getFile,
    getNextPending,
    clearCompleted,
    retryItem,
    getPlaybackUrl,
    processingRef,
  };
}
