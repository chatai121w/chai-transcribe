/**
 * Central feature-flag registry.
 *
 * Each flag is backed by a localStorage key. Most flags here are already
 * controlled elsewhere in the app via the same key — this registry just
 * exposes them in one place (a master /features toggle screen + inline
 * chips) so the user can quickly enable/disable them without breaking
 * anything.
 *
 * Adding a new flag:
 *   1. Add an entry to FEATURE_FLAGS below.
 *   2. Read it with useFeatureFlag(key) anywhere (or readFlag/writeFlag).
 *   3. Optional: render <FeatureToggleChip flagKey="…" /> next to the
 *      feature's UI for quick access.
 */

import { useCallback, useEffect, useState } from "react";

export type FlagCategory =
  | "transcription"
  | "pronunciation"
  | "audio"
  | "ai"
  | "experimental"
  | "ui";

export interface FeatureFlag {
  /** localStorage key. Reuse the app's existing key when wrapping an existing toggle. */
  key: string;
  label: string;
  description: string;
  category: FlagCategory;
  /** Default value when localStorage is empty. */
  defaultOn: boolean;
  /** Mark as experimental → shows a warning chip. */
  experimental?: boolean;
  /** Risk note shown next to the toggle. */
  risk?: string;
  /** Toggle saves preference but is not yet wired into the pipeline. */
  comingSoon?: boolean;
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  // ── Pronunciation ─────────────────────────────────────────
  {
    key: "personal_pronunciation_enabled",
    label: "מודל הגייה אישי",
    description: "מחיל את מאגר התיקונים האישי שלך על תמלולים חדשים.",
    category: "pronunciation",
    defaultOn: true,
  },
  {
    key: "loshon_kodesh_enabled",
    label: "לשון הקודש (אשכנזי)",
    description: "הפעלת ערכת הגייה אשכנזית — מתקן אוטומטית מילים נפוצות.",
    category: "pronunciation",
    defaultOn: false,
  },
  {
    key: "ff_ai_post_correction",
    label: "תיקון AI סופי",
    description: "מריץ Gemini על הטקסט המלא בסיום התמלול לתיקוני כתיב והגייה.",
    category: "ai",
    defaultOn: false,
    experimental: true,
    risk: "מוסיף ~3-8 שניות וצריכת מכסת API.",
  },
  {
    key: "ff_names_dictionary",
    label: "מילון שמות פרטיים",
    description: "מחליף שמות בכתיב חסידי לכתיב תקני (מויישע→משה).",
    category: "pronunciation",
    defaultOn: false,
    experimental: true,
  },

  // ── Transcription engines ─────────────────────────────────
  {
    key: "diarize_enabled",
    label: "זיהוי דוברים (Diarization)",
    description: "מסמן דובר 1 / דובר 2 בתמלול. איטי יותר.",
    category: "transcription",
    defaultOn: false,
    risk: "מאריך תמלול ב-30-100%.",
  },
  {
    key: "cuda_fast_mode",
    label: "מצב מהיר (CUDA)",
    description: "מוריד דיוק קל לטובת מהירות בתמלול לוקלי.",
    category: "transcription",
    defaultOn: false,
  },
  {
    key: "cuda_vad_aggressive",
    label: "VAD אגרסיבי",
    description: "מדלג על שקטים — מהיר יותר אבל עלול לחתוך מילים בקצוות.",
    category: "audio",
    defaultOn: false,
    risk: "עלול לחתוך מילים בקצוות.",
  },
  {
    key: "cuda_no_condition_prev",
    label: "ללא תלות בהקשר קודם",
    description: "מונע חזרות (loops) בקטעים ארוכים — לפעמים פוגע בקוהרנטיות.",
    category: "transcription",
    defaultOn: false,
  },
  {
    key: "cuda_cloud_save",
    label: "שמירת תמלולי CUDA לענן",
    description: "מגבה תמלולים שרצו מקומית לענן.",
    category: "transcription",
    defaultOn: true,
  },

  // ── Audio (experimental — may not be wired yet) ───────────
  {
    key: "ff_agc_auto",
    label: "AGC אוטומטי",
    description: "AGC של הדפדפן — מאזן רמת קלט מיקרופון בזמן אמת. כיבוי = רמה גולמית.",
    category: "audio",
    defaultOn: true,
  },
  {
    key: "ff_pre_roll_buffer",
    label: "Pre-roll buffer (2 שניות לפני לחיצה)",
    description: "שומר חלון מתגלגל של 2 שניות אודיו לפני שלחצת הקלט — כך לא מפספסים את ההברה הראשונה. פעיל ב-Live (מצב Groq).",
    category: "audio",
    defaultOn: false,
    experimental: true,
  },
  {
    key: "ff_audio_quality_check",
    label: "בדיקת איכות אודיו",
    description: "לפני תמלול — בודק רעש/חיתוך/קצב דגימה ומציג אזהרה אם זוהתה בעיה.",
    category: "audio",
    defaultOn: true,
    experimental: true,
  },
  {
    key: "ff_smart_chunking",
    label: "חיתוך חכם בשתיקות",
    description: "במקום חיתוך לפי בייטים — חותך על גבול שקט. דיוק טוב יותר בקצוות. רק לתמלול ברקע.",
    category: "audio",
    defaultOn: false,
    experimental: true,
    risk: "מאט את שלב ההכנה (פענוח אודיו + ניתוח). הקלטות קצרות יוצאות chunk אחד.",
  },
  {
    key: "ff_auto_resume",
    label: "המשך אוטומטי בנפילת רשת",
    description: "ממשיך תמלול ענן אחרי ניתוק רשת זמני (עד 4 ניסיונות עם backoff).",
    category: "transcription",
    defaultOn: true,
  },

  // ── UI ────────────────────────────────────────────────────
  {
    key: "ff_show_quick_toggles",
    label: "אייקוני טוגל מהירים",
    description: "מציג אייקוני הפעלה/כיבוי קטנים ליד פיצ'רים בעמוד התמלול.",
    category: "ui",
    defaultOn: true,
  },
];

export const CATEGORY_LABELS: Record<FlagCategory, string> = {
  transcription: "מנועי תמלול",
  pronunciation: "הגייה",
  audio: "אודיו",
  ai: "AI",
  experimental: "ניסיוני",
  ui: "ממשק",
};

// ── Storage helpers ─────────────────────────────────────────

function parseBool(raw: string | null, defaultOn: boolean): boolean {
  if (raw === null) return defaultOn;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "enabled") return true;
  if (raw === "0" || raw === "false" || raw === "off" || raw === "disabled") return false;
  return defaultOn;
}

export function readFlag(key: string): boolean {
  const meta = FEATURE_FLAGS.find(f => f.key === key);
  const def = meta?.defaultOn ?? false;
  try {
    return parseBool(localStorage.getItem(key), def);
  } catch {
    return def;
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
    // Notify same-tab listeners (storage event only fires cross-tab).
    window.dispatchEvent(new CustomEvent("featureFlagChange", { detail: { key, value } }));
  } catch {
    /* ignore */
  }
}

export function getFlagMeta(key: string): FeatureFlag | undefined {
  return FEATURE_FLAGS.find(f => f.key === key);
}

// ── Hook ────────────────────────────────────────────────────

export function useFeatureFlag(key: string): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => readFlag(key));

  useEffect(() => {
    const handler = (e: Event) => {
      // Same-tab custom event
      if (e instanceof CustomEvent && e.detail?.key === key) {
        setValue(Boolean(e.detail.value));
        return;
      }
      // Cross-tab storage event
      if (e instanceof StorageEvent && e.key === key) {
        setValue(readFlag(key));
      }
    };
    window.addEventListener("featureFlagChange", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("featureFlagChange", handler);
      window.removeEventListener("storage", handler);
    };
  }, [key]);

  const update = useCallback((v: boolean) => {
    setValue(v);
    writeFlag(key, v);
  }, [key]);

  return [value, update];
}
