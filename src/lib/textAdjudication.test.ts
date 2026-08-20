import { describe, expect, it } from "vitest";
import { buildAdjudicationUnits, composeAdjudicatedText, composeCorrectedSideText, replaceExactTextOccurrences } from "./textAdjudication";

describe("text adjudication", () => {
  it("creates a single-word conflict and preserves surrounding text", () => {
    const units = buildAdjudicationUnits("אמר בברא בתרא היום", "אמר בבא בתרא היום");
    const conflict = units.find((unit) => unit.kind === "conflict");
    expect(conflict?.leftText.trim()).toBe("בברא");
    expect(conflict?.rightText.trim()).toBe("בבא");
    expect(composeAdjudicatedText(units, {})).toBe("אמר בבא בתרא היום");
  });

  it("supports a phrase replacing one word", () => {
    const units = buildAdjudicationUnits("שמע האיגון היום", "שמע רב האי גאון היום");
    const conflict = units.find((unit) => unit.kind === "conflict");
    expect(conflict?.leftText.trim()).toBe("האיגון");
    expect(conflict?.rightText.trim()).toBe("רב האי גאון");
  });

  it("treats punctuation differences as a decision", () => {
    const units = buildAdjudicationUnits("שלום, עולם", "שלום. עולם");
    expect(units.filter((unit) => unit.kind === "conflict")).toHaveLength(1);
  });

  it("accepts a custom correction when both sources are wrong", () => {
    const units = buildAdjudicationUnits("מסכת בברא", "מסכת בטרה");
    const conflict = units.find((unit) => unit.kind === "conflict")!;
    const result = composeAdjudicatedText(units, {
      [conflict.id]: { choice: "custom", customText: "בבא בתרא" },
    });
    expect(result).toBe("מסכת בבא בתרא");
  });

  it("replaces all exact occurrences while preserving punctuation and longer words", () => {
    expect(replaceExactTextOccurrences("חורבים, ועוד חורבים. אבל מחורבים לא", "חורבים", "חורבן"))
      .toBe("חורבן, ועוד חורבן. אבל מחורבים לא");
  });

  it("applies a global correction to equal and conflicting units", () => {
    const units = buildAdjudicationUnits("חורבים כאן וגם חורבים", "חורבים פה וגם חורבים");
    expect(composeAdjudicatedText(units, {}, [{ source: "חורבים", replacement: "חורבן" }]))
      .toBe("חורבן פה וגם חורבן");
  });

  it("corrects only the requested source side without borrowing other unresolved differences", () => {
    const units = buildAdjudicationUnits("מיום רישון ועוד שגיאה", "מיום חישון ועוד תיקון");
    const firstConflict = units.find((unit) => unit.kind === "conflict");
    expect(firstConflict).toBeDefined();

    const correctedLeft = composeCorrectedSideText(
      units,
      "left",
      firstConflict!.id,
      firstConflict!.rightText,
    );

    expect(correctedLeft).toContain("מיום חישון");
    expect(correctedLeft).toContain("שגיאה");
    expect(correctedLeft).not.toContain("תיקון");
  });

  it("corrects all exact occurrences on one source side", () => {
    const units = buildAdjudicationUnits("מיום רישון ואז רישון", "מיום ראשון ואז ראשון");
    const conflict = units.find((unit) => unit.kind === "conflict");
    const corrected = composeCorrectedSideText(units, "left", conflict!.id, "ראשון ", "רישון ");
    expect(corrected).toBe("מיום ראשון ואז ראשון");
  });
});
