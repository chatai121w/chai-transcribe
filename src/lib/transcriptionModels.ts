/**
 * רשימת מנועי התמלול המקומיים — מקום אחד לכולם.
 *
 * הרשימה הזאת הייתה כתובה פעמיים, בשני רכיבים שונים, וכבר הספיקה
 * להתפצל: באחת היו שישה מנועים ובשנייה חמישה, והיידיש המלא היה חסר.
 * מי שבחר אותו במקום אחד לא מצא אותו באחר.
 *
 * מפתח ההעדפה משותף גם הוא, כדי שהבחירה תחול בכל המערכת ולא רק במסך
 * שבו נעשתה.
 */

export interface TranscriptionModel {
  value: string;
  /** שם קצר לתצוגה. */
  label: string;
  /** במה הוא טוב, במילים פשוטות. */
  hint: string;
  /** שפת היעד שלו. */
  language: "he" | "yi" | "multi";
}

export const TRANSCRIPTION_MODELS: TranscriptionModel[] = [
  {
    value: "ivrit-ai/whisper-large-v3-turbo-ct2",
    label: "Ivrit.ai Turbo V3",
    hint: "מהיר ומומלץ — עברית",
    language: "he",
  },
  {
    value: "ivrit-ai/whisper-large-v3-ct2",
    label: "Ivrit.ai Large V3",
    hint: "דיוק מרבי, איטי יותר — עברית",
    language: "he",
  },
  {
    value: "ivrit-ai/yi-whisper-large-v3-turbo-ct2",
    label: "Ivrit.ai יידיש Turbo",
    hint: "מהיר — יידיש",
    language: "yi",
  },
  {
    value: "ivrit-ai/yi-whisper-large-v3-ct2",
    label: "Ivrit.ai יידיש מלא",
    hint: "דיוק מרבי — יידיש",
    language: "yi",
  },
  {
    value: "large-v3-turbo",
    label: "Whisper Large V3 Turbo",
    hint: "מהיר — כל השפות",
    language: "multi",
  },
  {
    value: "large-v3",
    label: "Whisper Large V3",
    hint: "דיוק מרבי — כל השפות",
    language: "multi",
  },
];

/** המנוע שנבחר, כשאין העדפה שמורה. */
export const DEFAULT_TRANSCRIPTION_MODEL = TRANSCRIPTION_MODELS[0].value;

/** המפתח שבו נשמרת הבחירה, משותף לכל המסכים. */
export const PREFERRED_MODEL_KEY = "preferred_local_model";

/** השם להצגה של מנוע, גם כשהוא אינו ברשימה. */
export function modelLabel(value: string | null | undefined): string {
  if (!value) return "לא נבחר";
  const known = TRANSCRIPTION_MODELS.find((model) => model.value === value);
  if (known) return known.label;
  // מנוע שהגיע מהשרת ואינו ברשימה — מציגים את החלק האחרון בשמו
  return value.split("/").pop() || value;
}

/** המנוע השמור, או ברירת המחדל. */
export function readPreferredModel(storage?: Pick<Storage, "getItem">): string {
  try {
    const store = storage ?? window.localStorage;
    return store.getItem(PREFERRED_MODEL_KEY) || DEFAULT_TRANSCRIPTION_MODEL;
  } catch {
    return DEFAULT_TRANSCRIPTION_MODEL;
  }
}

export function writePreferredModel(value: string, storage?: Pick<Storage, "setItem">): void {
  try {
    const store = storage ?? window.localStorage;
    store.setItem(PREFERRED_MODEL_KEY, value);
  } catch {
    // אין אחסון. הבחירה תחול על הפעם הזאת בלבד.
  }
}

/**
 * אילו מנועים להציג.
 *
 * כשהשרת מדווח אילו מנועים הורדו, מציגים את אלה בלבד — אין טעם להציע
 * מנוע שיגרור הורדה של גיגה-בייטים בלי שהמשתמש ציפה לכך. כשאין דיווח,
 * מציגים הכול.
 */
export function availableModels(downloaded?: string[] | null): TranscriptionModel[] {
  if (!downloaded || !downloaded.length) return TRANSCRIPTION_MODELS;
  const have = new Set(downloaded);
  const ready = TRANSCRIPTION_MODELS.filter((model) => have.has(model.value));
  return ready.length ? ready : TRANSCRIPTION_MODELS;
}
