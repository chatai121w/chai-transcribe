/**
 * פריסות לפאנל הגדרות המנוע.
 *
 * הבעיה שזה פותר: כל כפתור בפאנל נמתח לכל רוחב השורה, בעוד
 * שהטקסט שבתוכו תופס שבריר מזה. כפתור "מהיר" ברוחב 500 נקודות
 * עם מילה אחת באמצע נראה כמו שטח ריק ענק, והעין צריכה לנדוד
 * רחוק בין האפשרויות.
 *
 * במקום להחליט במקומך — כאן יש ארבע פריסות, ואתה בוחר.
 *
 *   רחב      כמו שהיה: כל אפשרות תופסת את כל השורה.
 *   צמוד     הכפתורים ברוחב התוכן, מקובצים יחד כמו לשוניות.
 *   שורה     כל ההחלטות בשורה אחת, זו לצד זו.
 *   מינימלי  הכי דחוס: טקסט קטן, בלי שורות ההסבר.
 *
 * הבחירה נשמרת בענן ולא בדפדפן בלבד, כדי שתעבור גם למחשב אחר —
 * בדיוק הלקח שנלמד ממתג אוצר המילים, שנשמר מקומית ולא עבר.
 */

export type EnginePanelLayout = "wide" | "snug" | "row" | "mini";

export interface EnginePanelLayoutInfo {
  id: EnginePanelLayout;
  label: string;
  /** מה משתנה בפועל. */
  hint: string;
}

export const ENGINE_PANEL_LAYOUTS: EnginePanelLayoutInfo[] = [
  { id: "wide", label: "רחב",     hint: "כל אפשרות תופסת שורה שלמה" },
  { id: "snug", label: "צמוד",    hint: "כפתורים ברוחב הטקסט, מקובצים" },
  { id: "row",  label: "שורה",    hint: "כל ההחלטות בשורה אחת" },
  { id: "mini", label: "מינימלי", hint: "דחוס, בלי שורות הסבר" },
];

export function isEnginePanelLayout(value: unknown): value is EnginePanelLayout {
  return ENGINE_PANEL_LAYOUTS.some((l) => l.id === value);
}

export const DEFAULT_ENGINE_PANEL_LAYOUT: EnginePanelLayout = "snug";

/** המפתח בתוך שדה ההגדרות הכללי שבענן. */
export const ENGINE_PANEL_LAYOUT_KEY = "engine_panel_layout";

interface Classes {
  /** עטיפת כל הפאנל. */
  wrap: string;
  /** כרטיס של החלטה אחת. */
  card: string;
  /**
   * הגוף שבתוך הכרטיס.
   *
   * זה מה שתוקן: הכותרת ישבה בשורה אחת, הכפתורים בשורה שמתחתיה,
   * ושניהם נצמדו לצד אחד. כך נוצר שטח ריק שתופס את רוב רוחב
   * הכרטיס ומכפיל את גובהו בלי להוסיף שום דבר.
   *
   * בפריסות הצפופות הגוף הוא שורה אחת: הכותרת בצד אחד והפקדים
   * בצד השני, והרווח ביניהם הוא מה שממלא את הכרטיס.
   */
  body: string;
  /** שורת הכפתורים בתוך כרטיס. */
  group: string;
  /** כפתור בודד. */
  button: string;
  /** שורת ההסבר מתחת. */
  hint: string;
  /** כותרת החלק. */
  label: string;
}

/**
 * מחזיר את מחלקות העיצוב לפי הפריסה.
 *
 * הכל במקום אחד ולא פזור בין הרכיבים: פריסה שנשברת היא כמעט תמיד
 * פריסה שעודכנה בשלושה מקומות ובשניים מהם שכחו.
 */
export function enginePanelClasses(layout: EnginePanelLayout): Classes {
  switch (layout) {
    case "wide":
      return {
        wrap: "grid gap-3 lg:grid-cols-2",
        card: "rounded-lg border bg-muted/20 p-3",
        // הפריסה הרחבה נשארת מוערמת בכוונה — זאת האפשרות
        // ה"מרווחת", ומי שבוחר בה רוצה מטרות גדולות.
        body: "block",
        group: "flex gap-1.5",
        button: "h-8 flex-1 gap-1 text-xs",
        hint: "mt-1 text-right text-[10px] text-muted-foreground",
        label: "mb-2 block text-right text-xs font-medium",
      };

    case "row":
      // שורה אחת: הכרטיסים צרים, ולכן הכפתורים נערמים בתוכם.
      return {
        wrap: "grid gap-2 md:grid-cols-3",
        card: "rounded-lg border bg-muted/20 p-2.5",
        // שלוש עמודות צרות — הכותרת והפקדים לא נכנסים לשורה אחת.
        body: "block",
        group: "flex flex-wrap gap-1",
        button: "h-7 gap-1 px-2 text-[11px]",
        hint: "mt-1 text-right text-[10px] leading-snug text-muted-foreground",
        label: "mb-1.5 block text-right text-[11px] font-medium",
      };

    case "mini":
      return {
        wrap: "grid gap-1.5 md:grid-cols-2 xl:grid-cols-3",
        card: "rounded-md border bg-muted/20 p-2",
        body: "flex flex-wrap items-center justify-between gap-2",
        group: "flex flex-wrap gap-1",
        button: "h-6 gap-1 px-2 text-[11px]",
        // ההסברים מוסתרים לגמרי — זאת כל המטרה של המצב הזה.
        hint: "hidden",
        label: "shrink-0 text-right text-[11px] font-medium",
      };

    case "snug":
    default:
      // ברירת המחדל: הכפתורים ברוחב התוכן ומקובצים יחד, כך שהעין
      // רואה אותם כקבוצה אחת ולא כשלוש שורות נפרדות.
      return {
        wrap: "grid gap-3 lg:grid-cols-2",
        card: "rounded-lg border bg-muted/20 p-3",
        // הכותרת בצד אחד והפקדים בצד השני, באותה שורה. זה מה
        // שממלא את רוחב הכרטיס במקום להשאיר אותו ריק.
        body: "flex flex-wrap items-center justify-between gap-x-4 gap-y-2",
        group: "inline-flex flex-wrap gap-1 rounded-lg border bg-background/60 p-1",
        button: "h-7 gap-1 px-3 text-xs",
        hint: "mt-1.5 text-right text-[10px] text-muted-foreground",
        label: "shrink-0 text-right text-xs font-medium",
      };
  }
}
