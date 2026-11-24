import { describe, it, expect, vi } from "vitest";
import { meansServerIsGone, createPortResolver } from "./whisperBridge";

describe("הבחנה בין שרת שנעלם לבין פנייה שבוטלה", () => {
  it("מזהה תקלות שאומרות שאין שרת", () => {
    expect(meansServerIsGone("ECONNREFUSED")).toBe(true);
    expect(meansServerIsGone("ETIMEDOUT")).toBe(true);
    expect(meansServerIsGone("EHOSTUNREACH")).toBe(true);
  });

  it("אינו מתייחס לביטול של הדפדפן כאילו השרת נעלם", () => {
    // זו הייתה התקלה: כל ביטול כזה החזיר את הגישור למצב קר
    expect(meansServerIsGone("ECONNRESET")).toBe(false);
    expect(meansServerIsGone("ERR_ABORTED")).toBe(false);
    expect(meansServerIsGone("EPIPE")).toBe(false);
    expect(meansServerIsGone(undefined)).toBe(false);
    expect(meansServerIsGone(null)).toBe(false);
  });
});

const PORTS = Array.from({ length: 20 }, (_, index) => 3000 + index);

describe("חיפוש הדלת של שרת התמלול", () => {
  it("מוצא את הדלת המוכרת בבדיקה אחת בלבד", async () => {
    const probe = vi.fn(async (port: number) => port === 3000);
    const resolver = createPortResolver({ ports: PORTS, probe });

    await resolver.ensure();

    expect(resolver.port).toBe(3000);
    expect(resolver.verified).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("מוצא את השרת גם כשהוא עבר לדלת אחרת, ומדווח על כך", async () => {
    const probe = vi.fn(async (port: number) => port === 3007);
    const onMoved = vi.fn();
    const resolver = createPortResolver({ ports: PORTS, probe, onMoved });

    await resolver.ensure();

    expect(resolver.port).toBe(3007);
    expect(onMoved).toHaveBeenCalledWith(3007);
  });

  it("כמה פניות בו-זמנית פותחות חיפוש אחד בלבד", async () => {
    // זה לב התקלה: הדפדפן שולח כמה בדיקות בריאות באותו רגע
    let running = 0;
    let maxRunning = 0;
    const probe = vi.fn(async (port: number) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return port === 3000;
    });
    const resolver = createPortResolver({ ports: PORTS, probe });

    await Promise.all(Array.from({ length: 7 }, () => resolver.ensure()));

    expect(probe).toHaveBeenCalledTimes(1);
    expect(maxRunning).toBe(1);
    expect(resolver.port).toBe(3000);
  });

  it("אחרי שנמצאה הדלת, פניות נוספות אינן בודקות שוב", async () => {
    const probe = vi.fn(async (port: number) => port === 3000);
    const resolver = createPortResolver({ ports: PORTS, probe });

    await resolver.ensure();
    await resolver.ensure();
    await resolver.ensure();

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("אחרי ביטול התוקף מחפשים שוב", async () => {
    const probe = vi.fn(async (port: number) => port === 3000);
    const resolver = createPortResolver({ ports: PORTS, probe });

    await resolver.ensure();
    resolver.invalidate();
    expect(resolver.verified).toBe(false);
    await resolver.ensure();

    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("כששום דלת אינה עונה, אין קריסה והחיפוש פשוט לא מאומת", async () => {
    const probe = vi.fn(async () => false);
    const resolver = createPortResolver({ ports: PORTS, probe });

    await resolver.ensure();

    expect(resolver.verified).toBe(false);
    // הדלת המוכרת נבדקת פעם אחת לבד, ואז כל הטווח
    expect(probe).toHaveBeenCalledTimes(1 + PORTS.length);
  });

  it("חיפוש שנכשל אינו נועל את הגישור לנצח", async () => {
    let fail = true;
    const probe = vi.fn(async (port: number) => {
      if (fail) throw new Error("השרת לא זמין");
      return port === 3000;
    });
    const resolver = createPortResolver({ ports: PORTS, probe });

    await expect(resolver.ensure()).rejects.toThrow();
    fail = false;
    await resolver.ensure();

    expect(resolver.verified).toBe(true);
  });
});
