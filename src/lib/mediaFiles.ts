/**
 * זיהוי קבצי אודיו ווידאו, ואיסוף שלהם מגרירה או מבחירת תיקייה.
 *
 * עד עכשיו הפונקציה `isAudioOrVideo` הייתה כתובה פעמיים, מילה במילה,
 * בשני רכיבים שונים. כאן היא יושבת פעם אחת, וכל מי שצריך אותה מייבא
 * אותה — כך רשימת הסיומות לא יכולה להתפצל בלי שאף אחד ישים לב.
 */

/** הסיומות שמתקבלות גם כשהמערכת לא מזהה את סוג הקובץ בעצמה. */
const MEDIA_EXTENSIONS = [
  "mp3", "wav", "m4a", "ogg", "flac", "aac", "wma", "opus",
  "mp4", "webm", "avi", "mov", "mkv", "wmv", "amr", "3gp", "3gpp",
  "aiff", "aif", "caf", "spx", "gsm",
] as const;

/** כמה עומק נכנסים לתוך תיקיות מקוננות. מגן מפני קיצור דרך מעגלי. */
const MAX_FOLDER_DEPTH = 8;

/** תקרת קבצים לגרירה אחת, שלא ייתקע הדפדפן על תיקייה ענקית. */
const MAX_FILES_PER_DROP = 500;

export function isAudioOrVideo(file: File): boolean {
  if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return true;
  const extension = file.name.toLowerCase().split(".").pop() || "";
  return (MEDIA_EXTENSIONS as readonly string[]).includes(extension);
}

/** מסנן רשימת קבצים ומשאיר רק אודיו ווידאו, לפי סדר השם. */
export function filterMediaFiles(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list)
    .filter(isAudioOrVideo)
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

/**
 * מערכת הקבצים של הדפדפן מגישה תיקייה שנגררה כ"רשומה", לא כקובץ.
 * הטיפוסים האלה אינם קיימים בהגדרות הסטנדרטיות, ולכן מוגדרים כאן.
 */
interface DroppedEntry {
  isFile: boolean;
  isDirectory: boolean;
  file?: (onSuccess: (file: File) => void, onError?: (error: unknown) => void) => void;
  createReader?: () => {
    readEntries: (onSuccess: (entries: DroppedEntry[]) => void, onError?: (error: unknown) => void) => void;
  };
}

function entryToFile(entry: DroppedEntry): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) {
      resolve(null);
      return;
    }
    entry.file((file) => resolve(file), () => resolve(null));
  });
}

/** קורא תיקייה אחת. הדפדפן מחזיר עד מאה פריטים בכל קריאה, ולכן חוזרים. */
function readFolder(entry: DroppedEntry): Promise<DroppedEntry[]> {
  return new Promise((resolve) => {
    const reader = entry.createReader?.();
    if (!reader) {
      resolve([]);
      return;
    }
    const collected: DroppedEntry[] = [];
    const readNext = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(collected);
          return;
        }
        collected.push(...batch);
        if (collected.length >= MAX_FILES_PER_DROP) {
          resolve(collected);
          return;
        }
        readNext();
      }, () => resolve(collected));
    };
    readNext();
  });
}

async function collectFromEntry(entry: DroppedEntry, depth: number, out: File[]): Promise<void> {
  if (out.length >= MAX_FILES_PER_DROP) return;

  if (entry.isFile) {
    const file = await entryToFile(entry);
    if (file && isAudioOrVideo(file)) out.push(file);
    return;
  }

  if (entry.isDirectory && depth < MAX_FOLDER_DEPTH) {
    const children = await readFolder(entry);
    for (const child of children) {
      await collectFromEntry(child, depth + 1, out);
    }
  }
}

/**
 * אוסף את קבצי האודיו והווידאו מתוך גרירה — גם כשנגררה תיקייה שלמה.
 *
 * חשוב: הדפדפן מנקה את נתוני הגרירה ברגע שהפונקציה שטיפלה באירוע
 * מסתיימת. לכן הרשומות נקראות כאן **לפני** ההמתנה הראשונה, ורק אחר כך
 * נכנסים לתוך התיקיות.
 */
export async function mediaFilesFromDrop(transfer: DataTransfer | null): Promise<File[]> {
  if (!transfer) return [];

  const entries: DroppedEntry[] = [];
  const items = transfer.items;
  if (items) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index] as DataTransferItem & { webkitGetAsEntry?: () => DroppedEntry | null };
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
  }

  // אין תמיכה ברשומות (או שלא נגררו כאלה) — נופלים לרשימת הקבצים הרגילה
  if (!entries.length) return filterMediaFiles(transfer.files);

  const collected: File[] = [];
  for (const entry of entries) {
    await collectFromEntry(entry, 0, collected);
  }

  // תיקייה יכולה להחזיר את אותו קובץ פעמיים אם הוגשה גם כרשומה וגם כקובץ
  const seen = new Set<string>();
  const unique = collected.filter((file) => {
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.sort((a, b) => a.name.localeCompare(b.name, "he"));
}

export const MEDIA_FILE_LIMITS = {
  maxFilesPerDrop: MAX_FILES_PER_DROP,
  maxFolderDepth: MAX_FOLDER_DEPTH,
};
