import { describe, it, expect } from "vitest";
import { stageMessage, estimateRemainingSec } from "./transcribeStage";

describe("הודעת השלב בתמלול", () => {
  it("מתרגמת כל שלב לעברית", () => {
    expect(stageMessage("queued")).toBe("ממתין בתור…");
    expect(stageMessage("loading")).toBe("טוען את מנוע התמלול…");
    expect(stageMessage("preprocessing")).toBe("מכין את האודיו…");
    expect(stageMessage("info")).toBe("מתחיל לתמלל…");
    expect(stageMessage("session")).toBe("האודיו מוכן בשרת");
  });

  it("מוסיפה אחוזים בשלב ההעלאה", () => {
    expect(stageMessage("uploading", 42)).toBe("מעלה את הקובץ לשרת… 42%");
    expect(stageMessage("uploading", 42.6)).toBe("מעלה את הקובץ לשרת… 43%");
  });

  it("אינה ממציאה אחוזים כשאין", () => {
    expect(stageMessage("uploading")).toBe("מעלה את הקובץ לשרת…");
    expect(stageMessage("uploading", Number.NaN)).toBe("מעלה את הקובץ לשרת…");
  });

  it("מחזירה כלום לשלב שאינו מוכר, במקום להציג שם באנגלית", () => {
    expect(stageMessage("segment")).toBeNull();
    expect(stageMessage("done")).toBeNull();
    expect(stageMessage("")).toBeNull();
  });
});

describe("הערכת הזמן שנותר", () => {
  it("מחשבת לפי הקצב עד כה", () => {
    // עשר שניות הביאו לחצי הדרך, ולכן נותרו עוד כעשר
    expect(estimateRemainingSec(10, 50)).toBeCloseTo(10, 5);
    // ארבע שניות לרבע הדרך — נותרו שתים עשרה
    expect(estimateRemainingSec(4, 25)).toBeCloseTo(12, 5);
  });

  it("אינה מעריכה בהתחלה, כשההערכה חסרת ערך", () => {
    expect(estimateRemainingSec(1, 0)).toBeNull();
    expect(estimateRemainingSec(1, 2)).toBeNull();
  });

  it("אינה מעריכה כשהכול הסתיים", () => {
    expect(estimateRemainingSec(10, 100)).toBeNull();
  });

  it("אינה קורסת על ערכים לא תקינים", () => {
    expect(estimateRemainingSec(0, 50)).toBeNull();
    expect(estimateRemainingSec(-5, 50)).toBeNull();
    expect(estimateRemainingSec(10, Number.NaN)).toBeNull();
  });
});
