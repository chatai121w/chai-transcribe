// Tiny IndexedDB-backed store for the parallel "backup" recording of the live
// transcriber. Persists raw MediaRecorder timeslice blobs while recording, so
// a tab crash or accidental refresh doesn't lose the audio.
//
// Schema: one object store "chunks" keyed by autoincrement id.
// Each row: { sessionId: string, seq: number, blob: Blob, mime: string, t: number }
// Sessions are isolated by sessionId so we can clear one without touching others.

const DB_NAME = "live-backup-audio";
const DB_VERSION = 1;
const STORE = "chunks";

interface ChunkRow {
  id?: number;
  sessionId: string;
  seq: number;
  blob: Blob;
  mime: string;
  t: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        os.createIndex("sessionId", "sessionId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function backupAppendChunk(sessionId: string, seq: number, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add({
        sessionId, seq, blob, mime: blob.type || "audio/webm", t: Date.now(),
      } as ChunkRow);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("[backupAudioStore] append failed", e);
  }
}

export async function backupClearSession(sessionId: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const os = tx.objectStore(STORE);
      const idx = os.index("sessionId");
      const req = idx.openCursor(IDBKeyRange.only(sessionId));
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) { cur.delete(); cur.continue(); }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) {
    console.warn("[backupAudioStore] clear failed", e);
  }
}

export async function backupListSessions(): Promise<Array<{ sessionId: string; chunkCount: number; bytes: number; firstAt: number; lastAt: number; mime: string }>> {
  try {
    const db = await openDb();
    const rows: ChunkRow[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as ChunkRow[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const bySession = new Map<string, { sessionId: string; chunkCount: number; bytes: number; firstAt: number; lastAt: number; mime: string }>();
    for (const r of rows) {
      const cur = bySession.get(r.sessionId);
      if (cur) {
        cur.chunkCount += 1;
        cur.bytes += r.blob.size;
        cur.firstAt = Math.min(cur.firstAt, r.t);
        cur.lastAt = Math.max(cur.lastAt, r.t);
      } else {
        bySession.set(r.sessionId, {
          sessionId: r.sessionId, chunkCount: 1, bytes: r.blob.size,
          firstAt: r.t, lastAt: r.t, mime: r.mime,
        });
      }
    }
    return Array.from(bySession.values()).sort((a, b) => b.lastAt - a.lastAt);
  } catch (e) {
    console.warn("[backupAudioStore] list failed", e);
    return [];
  }
}

export async function backupGetSessionBlob(sessionId: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const rows: ChunkRow[] = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const idx = tx.objectStore(STORE).index("sessionId");
      const req = idx.getAll(IDBKeyRange.only(sessionId));
      req.onsuccess = () => resolve(req.result as ChunkRow[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (rows.length === 0) return null;
    rows.sort((a, b) => a.seq - b.seq);
    return new Blob(rows.map(r => r.blob), { type: rows[0].mime });
  } catch (e) {
    console.warn("[backupAudioStore] getSessionBlob failed", e);
    return null;
  }
}
