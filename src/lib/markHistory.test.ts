import { describe, it, expect } from "vitest";
import {
  emptyHistory,
  record,
  undo,
  redo,
  canUndo,
  canRedo,
  sameSnapshot,
  shouldOpenNewStep,
  describeSnapshot,
  MAX_HISTORY,
  GROUP_WINDOW_MS,
  type MarkSnapshot,
} from "./markHistory";

const snap = (...pairs: Array<[number, number]>): MarkSnapshot => ({
  ranges: pairs.map(([startSec, endSec]) => ({ startSec, endSec })),
  mode: "keep",
});

describe("ביטול פעולה בסימוני החיתוך", () => {
  it("בלי היסטוריה אין מה לבטל ואין לאן לחזור", () => {
    const history = emptyHistory<MarkSnapshot>();
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undo(history, snap())).toBeNull();
    expect(redo(history, snap())).toBeNull();
  });

  it("ביטול מחזיר את המצב שלפני הסימון", () => {
    const before = snap();
    const after = snap([1, 2]);

    const history = record(emptyHistory<MarkSnapshot>(), before);
    expect(canUndo(history)).toBe(true);

    const step = undo(history, after);
    expect(step).not.toBeNull();
    expect(step!.snapshot).toEqual(before);
    expect(canUndo(step!.history)).toBe(false);
    expect(canRedo(step!.history)).toBe(true);
  });

  it("אחרי ביטול אפשר לחזור קדימה ולקבל בדיוק את מה שבוטל", () => {
    const before = snap();
    const after = snap([1, 2]);
    const undone = undo(record(emptyHistory<MarkSnapshot>(), before), after)!;

    const back = redo(undone.history, undone.snapshot);
    expect(back).not.toBeNull();
    expect(back!.snapshot).toEqual(after);
  });

  it("שלושה סימונים — שלוש לחיצות ביטול מחזירות לריק", () => {
    const states = [snap(), snap([1, 2]), snap([1, 2], [5, 6]), snap([1, 2], [5, 6], [9, 10])];
    let history = emptyHistory<MarkSnapshot>();
    states.slice(0, 3).forEach((state) => { history = record(history, state); });

    let current = states[3];
    for (let i = 2; i >= 0; i -= 1) {
      const step = undo(history, current)!;
      history = step.history;
      current = step.snapshot;
      expect(current).toEqual(states[i]);
    }
    expect(canUndo(history)).toBe(false);
  });

  it("סימון חדש אחרי ביטול מוחק את האפשרות לחזור קדימה", () => {
    const undone = undo(record(emptyHistory<MarkSnapshot>(), snap()), snap([1, 2]))!;
    expect(canRedo(undone.history)).toBe(true);

    const afterNewMark = record(undone.history, snap([3, 4]));
    expect(canRedo(afterNewMark)).toBe(false);
  });

  it("ניקוי כל הסימונים הוא צעד שאפשר לבטל", () => {
    // זה המקרה הכואב: לחיצה אחת מוחקת הכול
    const full = snap([1, 2], [5, 6], [9, 10]);
    const history = record(emptyHistory<MarkSnapshot>(), full);
    const step = undo(history, snap())!;
    expect(step.snapshot.ranges).toHaveLength(3);
  });

  it("ההיסטוריה אינה גדלה בלי גבול", () => {
    let history = emptyHistory<MarkSnapshot>();
    for (let i = 0; i < MAX_HISTORY + 20; i += 1) history = record(history, snap([i, i + 1]));
    expect(history.past).toHaveLength(MAX_HISTORY);
    // הישנים ביותר נזרקים, והאחרונים נשמרים
    expect(history.past[history.past.length - 1].ranges[0].startSec).toBe(MAX_HISTORY + 19);
  });
});

describe("זיהוי מצב זהה", () => {
  it("אותם סימונים ואותו מצב — זהים", () => {
    expect(sameSnapshot(snap([1, 2]), snap([1, 2]))).toBe(true);
  });

  it("הפרש זניח בזמן אינו נחשב שינוי", () => {
    expect(sameSnapshot(snap([1, 2]), snap([1.0001, 2]))).toBe(true);
  });

  it("הזזה אמיתית של קצה נחשבת שינוי", () => {
    expect(sameSnapshot(snap([1, 2]), snap([1, 2.5]))).toBe(false);
  });

  it("מספר סימונים שונה — שינוי", () => {
    expect(sameSnapshot(snap([1, 2]), snap([1, 2], [3, 4]))).toBe(false);
  });

  it("אותם סימונים אבל מצב עבודה אחר — שינוי", () => {
    expect(sameSnapshot(snap([1, 2]), { ...snap([1, 2]), mode: "remove" })).toBe(false);
  });
});

describe("קיבוץ שינויים רצופים לצעד אחד", () => {
  it("הצעד הראשון תמיד נפתח", () => {
    expect(shouldOpenNewStep(snap(), snap([1, 2]), 1000, 0)).toBe(true);
  });

  it("גרירה רצופה של אותו קצה אינה מתפצלת לעשרות צעדים", () => {
    // אותו מספר סימונים — רק הקצה זז
    expect(shouldOpenNewStep(snap([1, 2]), snap([1, 2.1]), 1000, 950)).toBe(false);
    expect(shouldOpenNewStep(snap([1, 2]), snap([1, 2.1]), 1000, 1000 - GROUP_WINDOW_MS)).toBe(false);
  });

  it("אחרי הפסקה נפתח צעד חדש גם בלי שינוי במספר", () => {
    expect(shouldOpenNewStep(snap([1, 2]), snap([1, 2.1]), 2000, 1000)).toBe(true);
  });

  /* זה מה שנשבר בפועל: שני סימונים מהירים נמחקו בלחיצת ביטול אחת. */
  it("סימון נוסף הוא תמיד צעד בפני עצמו, גם מיד אחרי הקודם", () => {
    expect(shouldOpenNewStep(snap([1, 2]), snap([1, 2], [5, 6]), 1000, 999)).toBe(true);
  });

  it("הסרת סימון היא תמיד צעד בפני עצמו", () => {
    expect(shouldOpenNewStep(snap([1, 2], [5, 6]), snap([1, 2]), 1000, 999)).toBe(true);
  });

  it("החלפת מצב העבודה היא תמיד צעד בפני עצמו", () => {
    expect(shouldOpenNewStep(snap([1, 2]), { ...snap([1, 2]), mode: "remove" }, 1000, 999)).toBe(true);
  });
});

describe("תיאור הצעד למשתמש", () => {
  it("בעברית, ובלשון יחיד כשצריך", () => {
    expect(describeSnapshot(snap())).toBe("בלי סימונים");
    expect(describeSnapshot(snap([1, 2]))).toBe("סימון אחד");
    expect(describeSnapshot(snap([1, 2], [3, 4]))).toBe("2 סימונים");
  });
});
