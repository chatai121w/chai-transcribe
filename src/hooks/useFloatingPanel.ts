import { useCallback, useEffect, useRef, useState } from "react";

/**
 * חלונית צפה: גרירה למקום חדש, ושינוי גודל משמונה הכיוונים.
 *
 * למה הוק ולמה לא בתוך הרכיב: בפרויקט כבר יש חלונית אחת שיודעת
 * לשנות את גודלה, עם כל הלוגיקה כתובה בתוכה. עותק שני היה מתחיל
 * להתפצל ממנה ביום הראשון. ההוק הזה מרכז את מה שחוזר, כדי שכל
 * חלונית חדשה תתנהג אותו דבר בלי לכתוב זאת שוב.
 *
 * שלוש נקודות שלא מובנות מאליהן:
 *
 *  1. **הגבלה לגבולות המסך.** בלעדיה אפשר לגרור חלונית אל מחוץ
 *     למסך ולאבד אותה לגמרי — אין לאן ללחוץ כדי להחזיר.
 *
 *  2. **הגבלה מחדש בשינוי גודל החלון.** מי שגרר חלונית לפינה
 *     וסגר את החלון היה מוצא אותה בחוץ בפעם הבאה.
 *
 *  3. **המיקום נשמר כמרחק מהפינה ולא כאחוז.** אחוזים נראים נכון
 *     עד שמחליפים מסך, ואז החלונית קופצת למקום אחר.
 */

export interface PanelSize {
  width: number;
  height: number;
}

export interface PanelPos {
  /** מרחק משמאל, בנקודות. */
  left: number;
  /** מרחק מלמעלה, בנקודות. */
  top: number;
}

/** הכיוונים שאפשר למשוך מהם. */
export type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface Options {
  /** מפתח לשמירה. חייב להיות ייחודי לכל חלונית. */
  storageKey: string;
  defaultSize: PanelSize;
  minSize?: PanelSize;
  maxSize?: PanelSize;
  /** מיקום פתיחה כשאין מיקום שמור. */
  defaultPos?: (size: PanelSize) => PanelPos;
  /** כבוי פירושו שאין גרירה ואין שינוי גודל. */
  enabled?: boolean;
}

const MARGIN = 8;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* אין אחסון. הבחירה תחול על הפעם הזאת בלבד. */ }
}

export function useFloatingPanel({
  storageKey, defaultSize, minSize = { width: 240, height: 180 },
  maxSize = { width: 960, height: 900 }, defaultPos, enabled = true,
}: Options) {
  const sizeKey = `${storageKey}.size`;
  const posKey = `${storageKey}.pos`;

  const clampSize = useCallback((w: number, h: number): PanelSize => {
    const vw = typeof window === "undefined" ? maxSize.width : window.innerWidth;
    const vh = typeof window === "undefined" ? maxSize.height : window.innerHeight;
    const maxW = Math.max(minSize.width, Math.min(maxSize.width, vw - MARGIN * 2));
    const maxH = Math.max(minSize.height, Math.min(maxSize.height, vh - MARGIN * 2));
    return {
      width: Math.round(Math.max(minSize.width, Math.min(maxW, w))),
      height: Math.round(Math.max(minSize.height, Math.min(maxH, h))),
    };
  }, [minSize.width, minSize.height, maxSize.width, maxSize.height]);

  const clampPos = useCallback((left: number, top: number, s: PanelSize): PanelPos => {
    const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
    const vh = typeof window === "undefined" ? 800 : window.innerHeight;
    return {
      left: Math.round(Math.max(MARGIN, Math.min(vw - s.width - MARGIN, left))),
      top: Math.round(Math.max(MARGIN, Math.min(vh - s.height - MARGIN, top))),
    };
  }, []);

  const [size, setSize] = useState<PanelSize>(() => {
    const saved = read<PanelSize | null>(sizeKey, null);
    return saved && saved.width && saved.height
      ? clampSize(saved.width, saved.height)
      : clampSize(defaultSize.width, defaultSize.height);
  });

  const [pos, setPos] = useState<PanelPos>(() => {
    const saved = read<PanelPos | null>(posKey, null);
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      return clampPos(saved.left, saved.top, size);
    }
    const base = defaultPos ? defaultPos(size) : { left: MARGIN, top: MARGIN };
    return clampPos(base.left, base.top, size);
  });

  useEffect(() => { write(sizeKey, size); }, [sizeKey, size]);
  useEffect(() => { write(posKey, pos); }, [posKey, pos]);

  // גבולות המסך משתנים כשמשנים את גודל החלון, ולכן צריך להגביל שוב.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      setSize((s) => {
        const next = clampSize(s.width, s.height);
        setPos((p) => clampPos(p.left, p.top, next));
        return next;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampSize, clampPos]);

  const dragRef = useRef<
    | { kind: "move"; startX: number; startY: number; left: number; top: number }
    | { kind: "resize"; dir: ResizeDir; startX: number; startY: number;
        width: number; height: number; left: number; top: number }
    | null
  >(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;

      if (d.kind === "move") {
        setPos((p) => clampPos(d.left + dx, d.top + dy, sizeRef.current));
        return;
      }

      let w = d.width;
      let h = d.height;
      let left = d.left;
      let top = d.top;

      if (d.dir.includes("e")) w = d.width + dx;
      if (d.dir.includes("s")) h = d.height + dy;
      // משיכה משמאל או מלמעלה מזיזה גם את הפינה, אחרת הקצה הנגדי
      // זז במקום להישאר במקומו.
      if (d.dir.includes("w")) { w = d.width - dx; left = d.left + dx; }
      if (d.dir.includes("n")) { h = d.height - dy; top = d.top + dy; }

      const next = clampSize(w, h);
      // הגודל נחסם במינימום, ולכן הפינה חייבת לקחת את זה בחשבון —
      // אחרת החלונית "בורחת" כשמגיעים לגודל הקטן ביותר.
      if (d.dir.includes("w")) left = d.left + (d.width - next.width);
      if (d.dir.includes("n")) top = d.top + (d.height - next.height);
      setSize(next);
      setPos(clampPos(left, top, next));
    };

    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [clampSize, clampPos]);

  // הגודל העדכני דרוש בתוך מאזין הגרירה, שנרשם פעם אחת בלבד.
  const sizeRef = useRef(size);
  useEffect(() => { sizeRef.current = size; }, [size]);

  const begin = (cursor: string) => {
    document.body.style.userSelect = "none";
    document.body.style.cursor = cursor;
  };

  const startMove = useCallback((e: React.PointerEvent) => {
    if (!enabled) return;
    e.preventDefault();
    dragRef.current = {
      kind: "move", startX: e.clientX, startY: e.clientY,
      left: pos.left, top: pos.top,
    };
    begin("grabbing");
  }, [enabled, pos.left, pos.top]);

  const startResize = useCallback((dir: ResizeDir, cursor: string) => (e: React.PointerEvent) => {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      kind: "resize", dir, startX: e.clientX, startY: e.clientY,
      width: size.width, height: size.height, left: pos.left, top: pos.top,
    };
    begin(cursor);
  }, [enabled, size.width, size.height, pos.left, pos.top]);

  /** מחזיר את החלונית לגודל ולמיקום ההתחלתיים. */
  const reset = useCallback(() => {
    const s = clampSize(defaultSize.width, defaultSize.height);
    const base = defaultPos ? defaultPos(s) : { left: MARGIN, top: MARGIN };
    setSize(s);
    setPos(clampPos(base.left, base.top, s));
  }, [clampSize, clampPos, defaultSize.width, defaultSize.height, defaultPos]);

  return { size, pos, setPos, startMove, startResize, reset };
}
