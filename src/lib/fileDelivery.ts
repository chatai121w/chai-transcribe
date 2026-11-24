/**
 * הוצאת קבצים מהאתר החוצה: שיתוף, ושמירה לתיקייה במחשב.
 *
 * **למה אין כאן "שלח במייל" ישיר:** דף באינטרנט אינו יכול לצרף קובץ
 * להודעת דואר. הקישור `mailto` יודע למלא נמען, נושא וגוף — ותו לא.
 * כל אתר שמבטיח צירוף קובץ עושה זאת דרך שרת ששולח בשמו.
 *
 * לכן יש כאן שתי דרכים אמיתיות:
 *
 *  1. **שיתוף** — תפריט השיתוף של המחשב או של הטלפון, שבתוכו יושבות
 *     תוכנת הדואר, וואטסאפ, טלגרם וכל השאר. הקובץ מצורף באמת.
 *  2. **שמירה לתיקייה במחשב** — בחירת תיקייה וכתיבת כל הקטעים לתוכה.
 *
 * שתיהן אינן קיימות בכל דפדפן, ולכן יש לכל אחת בדיקת זמינות, והממשק
 * מציג רק את מה שבאמת יעבוד.
 */

/** שם קובץ בטוח לכתיבה בתיקייה במחשב. */
export function safeFileName(name: string, fallback = "קטע"): string {
  const cleaned = name
    // תווים שמערכת הקבצים של חלונות אוסרת
    .replace(/[\\/:*?"<>|]/g, "-")
    // תווי בקרה, שמערכת הקבצים אינה מקבלת בשם
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    // נקודות בסוף שם נבלעות בחלונות
    .replace(/\.+$/, "");
  /*
    שם שנשארו בו רק מפרידים אינו שם. זה קרה כשכל התווים היו אסורים
    וכל אחד מהם הוחלף במקף — "///" הפך ל-"---", ובדיקת הריקנות לבדה
    לא תפסה את זה.
  */
  const hasContent = /[\p{L}\p{N}]/u.test(cleaned);
  const result = hasContent ? cleaned : fallback;
  // תקרה סבירה, שלא ייפול על אורך הנתיב
  return result.length > 120 ? result.slice(0, 120) : result;
}

/** מוסיף מספר לשם כשהוא כבר תפוס, כדי שקובץ לא ידרוס קובץ. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} (${index})${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})${extension}`;
}

// ─── שיתוף ───────────────────────────────────────────────────────────────

type ShareCapable = Navigator & {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
};

export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === "undefined" || !files.length) return false;
  const nav = navigator as ShareCapable;
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files });
  } catch {
    return false;
  }
}

export type ShareOutcome = "shared" | "cancelled" | "unsupported" | "failed";

export async function shareFiles(files: File[], title: string): Promise<ShareOutcome> {
  if (!canShareFiles(files)) return "unsupported";
  try {
    await (navigator as ShareCapable).share!({ files, title });
    return "shared";
  } catch (error) {
    // ביטול של המשתמש אינו תקלה
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
    return "failed";
  }
}

// ─── שמירה לתיקייה במחשב ─────────────────────────────────────────────────

interface WritableLike {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}

interface FileHandleLike {
  createWritable: () => Promise<WritableLike>;
}

export interface DirectoryHandleLike {
  name?: string;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandleLike>;
}

type DirectoryPicker = () => Promise<DirectoryHandleLike>;

export function canPickFolder(): boolean {
  return typeof window !== "undefined"
    && typeof (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker === "function";
}

export interface FolderSaveResult {
  status: "saved" | "cancelled" | "unsupported";
  folderName?: string;
  savedCount: number;
  failed: string[];
}

/**
 * כותב את הקבצים לתיקייה שהמשתמש יבחר.
 *
 * `pickFolder` ניתן להזרקה כדי שאפשר יהיה לבדוק את הפונקציה בלי
 * לפתוח חלון בחירת תיקייה אמיתי.
 */
export async function saveFilesToFolder(
  files: File[],
  pickFolder?: DirectoryPicker,
): Promise<FolderSaveResult> {
  const picker = pickFolder
    ?? (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (typeof picker !== "function") {
    return { status: "unsupported", savedCount: 0, failed: [] };
  }

  let directory: DirectoryHandleLike;
  try {
    directory = await picker();
  } catch (error) {
    // ביטול של המשתמש אינו תקלה
    if (error instanceof Error && error.name === "AbortError") {
      return { status: "cancelled", savedCount: 0, failed: [] };
    }
    return { status: "cancelled", savedCount: 0, failed: [] };
  }

  const taken = new Set<string>();
  const failed: string[] = [];
  let savedCount = 0;

  for (const file of files) {
    const name = uniqueName(safeFileName(file.name), taken);
    taken.add(name);
    try {
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(file);
      await writable.close();
      savedCount += 1;
    } catch {
      failed.push(file.name);
    }
  }

  return { status: "saved", folderName: directory.name, savedCount, failed };
}
