import type { DemoStyle } from "@/components/guide/GuideDemo";

/**
 * סגנון ההמחשות בהדרכה, ואם להציג אותן בכלל.
 *
 * למה בחירה ולא החלטה אחת: תנועה בכרטיס היא עזרה למי שלא ראה את
 * הפעולה מעולם, והסחה למי שכבר יודע. אותה המחשה בדיוק יכולה להיות
 * שתי החוויות האלה, ואין דרך לנחש מראש איזו מהן.
 *
 * הערך נשמר מקומית. זאת העדפת תצוגה אישית למסך הזה, ואין סיבה
 * שהיא תעבור בין מחשבים — אדם שעובד על מסך קטן יבחר אחרת.
 */

const KEY = "guide.demos";

export type GuideDemoPrefs = {
  /** האם להציג המחשות כלל. */
  enabled: boolean;
  style: DemoStyle;
};

/**
 * ברירת המחדל: מוצג, בסגנון השקט.
 *
 * שקט ולא חי, כי המחשה היא תוספת לטקסט ולא במקומו. מי שרוצה
 * תנועה ברורה יותר בוחר בה במפורש.
 */
export const GUIDE_DEMO_DEFAULT: GuideDemoPrefs = { enabled: true, style: "quiet" };

export function readGuideDemoPrefs(): GuideDemoPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return GUIDE_DEMO_DEFAULT;
    const o = JSON.parse(raw) as Partial<GuideDemoPrefs>;
    return {
      enabled: typeof o.enabled === "boolean" ? o.enabled : GUIDE_DEMO_DEFAULT.enabled,
      style: o.style === "lively" || o.style === "quiet" ? o.style : GUIDE_DEMO_DEFAULT.style,
    };
  } catch {
    // חלון פרטי, אחסון חסום, או ערך פגום. ברירת המחדל עדיפה על קריסה.
    return GUIDE_DEMO_DEFAULT;
  }
}

export function writeGuideDemoPrefs(p: GuideDemoPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // אין מה לעשות, וגם אין מה להפיל בגלל זה.
  }
}
