import { describe, it, expect } from "vitest";
import { buildCopyCutArgs, CUT_PREROLL_SEC } from "./tieredCutEngine";

/**
 * הבדיקות האלה נכתבו אחרי ניסוי על הקלטת וואטסאפ אמיתית, שחשף שתי
 * תקלות באותה פקודה:
 *
 *  1. הקטע השני נראה תקין לגמרי — גודל סביר, אורך רשום נכון — אבל
 *     פענח 78 בתים במקום 2.5 מגה. אף נגן לא הצליח לפתוח אותו.
 *  2. אחרי שתוקן והתפענח, הוא התחיל ב-23.50 שניות במקום ב-25.18 —
 *     חפיפה של 1.68 שניות עם הקטע שלפניו.
 */

/** שולף את הערך שאחרי דגל, בהתחשב בכך ש"ss-" מופיע פעמיים. */
function valuesAfter(args: string[], flag: string): string[] {
  const out: string[] = [];
  args.forEach((item, index) => { if (item === flag) out.push(args[index + 1]); });
  return out;
}

describe("פקודת החיתוך בלי קידוד מחדש", () => {
  it("מאפסת את חותמות הזמן — בלי זה כל קטע שאינו הראשון אינו ניתן לפיענוח", () => {
    const args = buildCopyCutArgs("in.ogg", "out.ogg", 25.183, 50.366);
    const index = args.indexOf("-avoid_negative_ts");
    expect(index).toBeGreaterThan(-1);
    expect(args[index + 1]).toBe("make_zero");
  });

  it("מעתיקה את הזרם במקום לקודד מחדש, כדי לשמור על האיכות", () => {
    const args = buildCopyCutArgs("in.ogg", "out.ogg", 0, 10);
    expect(args[args.indexOf("-c") + 1]).toBe("copy");
  });

  it("מדלגת בגסות עד שתי שניות לפני הנקודה, ואז מקצרת במדויק", () => {
    const args = buildCopyCutArgs("in.ogg", "out.ogg", 25.183, 50.366);
    const inputAt = args.indexOf("-i");
    const starts = valuesAfter(args, "-ss");

    // דילוג גס לפני הקובץ הנכנס — זה מה שעושה את זה מהיר
    expect(args.indexOf("-ss")).toBeLessThan(inputAt);
    expect(starts[0]).toBe("23.183");

    // והדיוק אחריו — זה מה שמונע את החפיפה
    expect(starts[1]).toBe("2.000");
    expect(valuesAfter(args, "-to")[0]).toBe("27.183");
  });

  it("אורך הקטע נשמר במדויק", () => {
    const args = buildCopyCutArgs("in.ogg", "out.ogg", 25.183, 50.366);
    const innerStart = Number(valuesAfter(args, "-ss")[1]);
    const innerEnd = Number(valuesAfter(args, "-to")[0]);
    expect(innerEnd - innerStart).toBeCloseTo(50.366 - 25.183, 3);
  });

  it("בקטע שמתחיל בהתחלה אין דילוג גס כלל", () => {
    const args = buildCopyCutArgs("in.ogg", "out.ogg", 0, 25.183);
    expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
    expect(valuesAfter(args, "-ss")).toEqual(["0.000"]);
    expect(valuesAfter(args, "-to")[0]).toBe("25.183");
  });

  it("בקטע שמתחיל לפני שתי שניות, הדילוג הגס נחסם באפס", () => {
    const args = buildCopyCutArgs("in.ogg", "out.ogg", 1.5, 4.5);
    // אין דילוג גס, והקיצור המדויק הוא מהזמן המקורי
    expect(args.indexOf("-ss")).toBeGreaterThan(args.indexOf("-i"));
    expect(valuesAfter(args, "-ss")).toEqual(["1.500"]);
    expect(valuesAfter(args, "-to")[0]).toBe("4.500");
  });

  it("מרווח הדילוג הוא שתי שניות", () => {
    expect(CUT_PREROLL_SEC).toBe(2);
  });

  it("משמיטה וידאו, ושם הקובץ היוצא אחרון", () => {
    const args = buildCopyCutArgs("in.ogg", "out.ogg", 0, 5);
    expect(args).toContain("-vn");
    expect(args[args.length - 1]).toBe("out.ogg");
  });
});
