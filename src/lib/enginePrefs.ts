/**
 * אילו מנועי תמלול להציג, ובאיזה סדר.
 *
 * למה זה קיים: על המסך מוצגים שמונה מנועים, ורוב המשתמשים עובדים
 * עם אחד או שניים. השאר תופסים מקום ומסיחים את העין בכל פעם מחדש.
 *
 * הערך נשמר בשדה ההגדרות שבענן, ולכן הבחירה עוברת גם למחשב אחר.
 * יש גם עותק מקומי, כי המסך מצויר לפני שהעדפות הענן נטענות —
 * בלעדיו המנועים היו מהבהבים: מופיעים, ואז נעלמים.
 */

export type EngineId =
  | "groq" | "openai" | "google" | "assemblyai" | "deepgram" | "gemini"
  | "local-server" | "local";

export const ENGINE_LABELS: Record<EngineId, string> = {
  groq: "Groq",
  openai: "OpenAI",
  google: "Google",
  assemblyai: "AssemblyAI",
  deepgram: "Deepgram",
  gemini: "Gemini",
  "local-server": "שרת מקומי",
  local: "דפדפן",
};

/** הסדר המקורי. מנוע חדש שיתווסף בעתיד נכנס לפי הרשימה הזאת. */
export const ENGINE_ORDER: EngineId[] = [
  "groq", "openai", "google", "assemblyai", "deepgram", "gemini",
  "local-server", "local",
];

export const ENGINE_PREFS_KEY = "engine_prefs";
const LOCAL_KEY = "engines.prefs";

export type EnginePrefs = {
  /** הסדר שהמשתמש קבע. מנוע שאינו ברשימה נוסף בסוף. */
  order: EngineId[];
  /** מה מוסתר. נשמר במפורש ולא כהיפוך של order — ראו below. */
  hidden: EngineId[];
};

export const ENGINE_PREFS_DEFAULT: EnginePrefs = { order: [], hidden: [] };

const isEngine = (v: unknown): v is EngineId =>
  typeof v === "string" && (ENGINE_ORDER as string[]).includes(v);

export function normalisePrefs(raw: unknown): EnginePrefs {
  const o = (raw ?? {}) as Partial<EnginePrefs>;
  const order = Array.isArray(o.order) ? o.order.filter(isEngine) : [];
  const hidden = Array.isArray(o.hidden) ? o.hidden.filter(isEngine) : [];
  // בלי הסרת כפילויות, גרירה חוזרת הייתה מכפילה מנוע ברשימה והוא
  // היה מצויר פעמיים.
  return { order: [...new Set(order)], hidden: [...new Set(hidden)] };
}

/**
 * הסדר המלא לתצוגה.
 *
 * מה שחשוב כאן: מנוע שאינו ברשימת הסדר **אינו נעלם** אלא נוסף
 * בסוף. בלי זה, מנוע חדש שיתווסף לתוכנה בעתיד לא היה מופיע כלל
 * אצל מי שכבר קבע סדר — והוא לא היה יודע שהוא קיים.
 */
export function orderedEngines(prefs: EnginePrefs): EngineId[] {
  const known = prefs.order.filter((e) => ENGINE_ORDER.includes(e));
  const rest = ENGINE_ORDER.filter((e) => !known.includes(e));
  return [...known, ...rest];
}

/**
 * האם מנוע מוצג.
 *
 * מנוע שנבחר כעת מוצג תמיד, גם אם סומן כמוסתר. אחרת המשתמש היה
 * מסתיר את המנוע שהוא עובד איתו, והמסך היה מראה שאף מנוע אינו
 * נבחר — בלי שום רמז למה.
 */
export function isEngineVisible(
  id: EngineId, prefs: EnginePrefs, selected?: string,
): boolean {
  if (selected && id === selected) return true;
  return !prefs.hidden.includes(id);
}

/** המנועים שיוצגו בפועל, בסדר הנכון. */
export function visibleEngines(
  prefs: EnginePrefs, selected?: string,
): EngineId[] {
  return orderedEngines(prefs).filter((e) => isEngineVisible(e, prefs, selected));
}

/**
 * מחליף הצגה והסתרה.
 *
 * אי אפשר להסתיר את האחרון שנשאר. מסך בלי שום מנוע הוא מסך שבור,
 * ואין ממנו דרך חזרה בלי לפתוח את ההגדרות שגם הן ריקות.
 */
export function toggleEngine(prefs: EnginePrefs, id: EngineId): EnginePrefs {
  const hidden = new Set(prefs.hidden);
  if (hidden.has(id)) {
    hidden.delete(id);
  } else {
    const shownAfter = ENGINE_ORDER.filter((e) => !hidden.has(e) && e !== id);
    if (shownAfter.length === 0) return prefs;
    hidden.add(id);
  }
  return { ...prefs, hidden: [...hidden] };
}

/** מעביר מנוע ממקום למקום. */
export function moveEngine(
  prefs: EnginePrefs, id: EngineId, toIndex: number,
): EnginePrefs {
  const order = orderedEngines(prefs);
  const from = order.indexOf(id);
  if (from < 0) return prefs;
  const target = Math.max(0, Math.min(order.length - 1, toIndex));
  if (from === target) return prefs;
  order.splice(from, 1);
  order.splice(target, 0, id);
  return { ...prefs, order };
}

// ------------------------------------------------- אחסון מקומי

export function readLocalEnginePrefs(): EnginePrefs {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? normalisePrefs(JSON.parse(raw)) : ENGINE_PREFS_DEFAULT;
  } catch {
    // חלון פרטי, אחסון חסום, או ערך פגום. ברירת המחדל עדיפה על קריסה.
    return ENGINE_PREFS_DEFAULT;
  }
}

export function writeLocalEnginePrefs(prefs: EnginePrefs): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(prefs));
  } catch {
    // אין מה לעשות, וגם אין מה להפיל בגלל זה.
  }
}
