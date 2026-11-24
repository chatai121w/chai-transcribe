/**
 * ההיגיון של הגישור בין האתר לשרת התמלול המקומי.
 *
 * הגישור עצמו יושב בקובץ ההגדרות של שרת הפיתוח, ושם אי אפשר לבדוק
 * אותו. שני החלקים שבהם היו תקלות אמיתיות נמצאים כאן, כדי שיהיו
 * מכוסים בבדיקות:
 *
 *  1. **חיפוש אחד בלבד בכל רגע.** הדפדפן שולח כמה בדיקות בריאות
 *     באותו רגע. קודם כל אחת מהן פתחה חיפוש משלה על עשרים דלתות,
 *     הראשונה נפלה בזמן, והאתר הכריז "ללא שרת" אף שהשרת פעל.
 *
 *  2. **ההבחנה בין שרת שנעלם לבין פנייה שבוטלה.** הדפדפן מבטל
 *     פניות כדבר שבשגרה. קודם כל ביטול כזה סומן כ"השרת נעלם",
 *     והחיפוש התחיל מחדש — כך המצב הקר לא נגמר אף פעם.
 */

/** קודי תקלה שאומרים באמת שאין שרת בצד השני. */
const SERVER_GONE_CODES = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EADDRNOTAVAIL",
]);

export function meansServerIsGone(code: string | undefined | null): boolean {
  return !!code && SERVER_GONE_CODES.has(code);
}

/**
 * האם מותר להגביל בזמן את ההמתנה לתשובה.
 *
 * **זו הייתה תקלה אמיתית, ולא תיאוריה.** הגבול נוסף כדי שבדיקת
 * בריאות תקועה לא תשאיר את הדפדפן ממתין בלי סוף — והוא הוחל על כל
 * פניות הקריאה. אבל זרם האירועים של התמלול הוא גם הוא פניית קריאה,
 * ארוכה מאוד: עד שהמנוע נטען עוברות יותר משמונה שניות בלי בית אחד.
 * התוצאה הייתה שכל תמלול נקטע בדיוק אחרי שמונה שניות, והאתר הכריז
 * שהשרת אינו מגיב — בזמן שהשרת עבד מצוין.
 *
 * לכן הגבול חל רק על בדיקת הבריאות, שהיא קצרה מעצם טבעה. כל השאר —
 * תמלול, זרמים, העלאות — ממתין כמה שצריך.
 */
export function shouldLimitReplyTime(method: string, path: string): boolean {
  const verb = (method || "").toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") return false;
  // רק הנתיב עצמו, בלי פרמטרים
  const clean = (path || "").split("?")[0].replace(/\/+$/, "");
  return clean === "/health" || clean.endsWith("/health");
}

export interface PortResolverOptions {
  /** כל הדלתות שאפשר לחפש בהן. */
  ports: number[];
  /** בודק אם בדלת מסוימת יושב שרת תמלול. */
  probe: (port: number) => Promise<boolean>;
  /** נקרא כשנמצאה דלת שונה מזו שהייתה. */
  onMoved?: (port: number) => void;
}

export interface PortResolver {
  /** מוודא שידועה דלת. חיפושים מקבילים מתאחדים לאחד. */
  ensure: () => Promise<void>;
  /** מבטל את מה שידוע, כדי שהחיפוש יתחיל מחדש בפעם הבאה. */
  invalidate: () => void;
  /** קובע דלת מראש, כשהיא ידועה ממקור אחר (הפעלת השרת מהממשק). */
  setPort: (port: number) => void;
  /** הדלת שאליה מעבירים כרגע. */
  readonly port: number;
  /** האם הדלת אומתה. */
  readonly verified: boolean;
}

export function createPortResolver({ ports, probe, onMoved }: PortResolverOptions): PortResolver {
  if (!ports.length) throw new Error("נדרשת לפחות דלת אחת לחיפוש");

  let active = ports[0];
  let verified = false;
  let inFlight: Promise<void> | null = null;

  const scan = async (): Promise<void> => {
    // הדלת המוכרת נבדקת לבדה תחילה. היא הנכונה כמעט תמיד, ואז
    // נגמר כאן — בלי לפתוח עשרים חיבורים לחינם.
    if (await probe(active)) {
      verified = true;
      return;
    }
    // לא נמצאה — סורקים את כל הטווח יחד ולא אחת אחרי השנייה.
    const found = await Promise.all(
      ports.map(async (port) => ((await probe(port)) ? port : null)),
    );
    const port = found.find((value): value is number => value !== null);
    if (port === undefined) return;
    if (port !== active) onMoved?.(port);
    active = port;
    verified = true;
  };

  return {
    ensure: async () => {
      if (verified) return;
      if (!inFlight) {
        inFlight = scan().finally(() => { inFlight = null; });
      }
      await inFlight;
    },
    invalidate: () => { verified = false; },
    setPort: (port: number) => {
      active = port;
      // הדלת הגיעה ממקור אחר ולא מבדיקה, ולכן עדיין לא מאומתת:
      // הפנייה הבאה תוודא שבאמת יושב שם שרת.
      verified = false;
    },
    get port() { return active; },
    get verified() { return verified; },
  };
}
