/**
 * שמירת מצב שולחן העבודה של החיתוך בין מעברי לשוניות.
 *
 * הלשוניות באתר מפרקות את התוכן שלהן כשעוברים מהן. לכן מי שתמלל קובץ,
 * עבר ללשונית אחרת וחזר — מצא אזור חיתוך ריק, בלי הקובץ ובלי רצועת
 * המילים, והיה צריך לתמלל הכול מחדש.
 *
 * תוצאות החיתוך עצמן כבר נשמרות (במנוע החיתוך). מה שלא נשמר היה
 * **הקובץ שבעבודה והתמלול שלו**, וזה מה שהקובץ הזה מוסיף.
 *
 * המצב נשמר במסד המקומי של הדפדפן, נפרד ממסד תוצאות החיתוך, כדי לא
 * לגעת במבנה שכבר עובד.
 */

import type { CutWord } from "@/lib/transcriptCut";

const DB_NAME = "cut-workbench";
const DB_VERSION = 1;
const STORE = "state";
const SINGLE_KEY = "current";

/** מצב ישן מזה נזרק. אין טעם לשמור אודיו של אתמול בדפדפן. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface WorkbenchState {
  file: File;
  label: string;
  /** התמלול, אם כבר נעשה. */
  words: CutWord[] | null;
  savedAt: number;
}

interface StoredState {
  key: string;
  blob: Blob;
  fileName: string;
  fileType: string;
  lastModified: number;
  label: string;
  words: CutWord[] | null;
  savedAt: number;
}

/** האם המצב השמור עדיין רלוונטי. פונקציה טהורה, כדי שתהיה נבדקת. */
export function isFresh(savedAt: number, now: number, maxAgeMs = MAX_AGE_MS): boolean {
  if (!Number.isFinite(savedAt) || savedAt <= 0) return false;
  // זמן עתידי פירושו ששעון המחשב זז. לא סומכים על זה.
  if (savedAt > now + 60_000) return false;
  return now - savedAt <= maxAgeMs;
}

/** המזהה של קובץ, לבדיקה שהתמלול שייך לקובץ שעל השולחן. */
export function fileKeyOf(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkbench(state: Omit<WorkbenchState, "savedAt">): Promise<void> {
  try {
    const db = await openDb();
    const stored: StoredState = {
      key: SINGLE_KEY,
      blob: state.file,
      fileName: state.file.name,
      fileType: state.file.type,
      lastModified: state.file.lastModified,
      label: state.label,
      words: state.words,
      savedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(stored);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // אין מסד מקומי זמין. העבודה תימשך, רק בלי שחזור אחרי מעבר לשונית.
  }
}

export async function loadWorkbench(now = Date.now()): Promise<WorkbenchState | null> {
  try {
    const db = await openDb();
    const stored = await new Promise<StoredState | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(SINGLE_KEY);
      request.onsuccess = () => resolve(request.result as StoredState | undefined);
      request.onerror = () => reject(request.error);
    });
    if (!stored || !stored.blob) return null;
    if (!isFresh(stored.savedAt, now)) {
      await clearWorkbench();
      return null;
    }
    const file = new File([stored.blob], stored.fileName, {
      type: stored.fileType,
      lastModified: stored.lastModified,
    });
    return {
      file,
      label: stored.label || stored.fileName,
      words: stored.words ?? null,
      savedAt: stored.savedAt,
    };
  } catch {
    return null;
  }
}

export async function clearWorkbench(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(SINGLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // כלום. הניקוי אינו קריטי.
  }
}
