import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TranscriptWordStrip from "./TranscriptWordStrip";
import type { CutWord } from "@/lib/transcriptCut";

/**
 * רצועת המילים היא הגשר בין הטקסט לחיתוך.
 *
 * מה שחייב לעבוד כאן: לחיצה מקפיצה את הנגן, סימון מייצר טווח זמן
 * נכון, והטווח שנשלח לחיתוך הוא בדיוק מה שהמשתמש סימן — לא יותר
 * ולא פחות. טעות של מילה אחת כאן היא חיתוך שגוי בקובץ.
 */

const WORDS: CutWord[] = [
  { word: "הכדירה", start: 0.00, end: 0.52, probability: 0.95 },
  { word: "חז״ל", start: 0.55, end: 0.98, probability: 0.99 },
  { word: "אסרו,", start: 1.02, end: 1.48, probability: 0.91 },
  { word: "לפגם.", start: 2.00, end: 2.60, probability: 0.88 },
  { word: "לא", start: 3.40, end: 3.62, probability: 0.3 },
  { word: "בשר", start: 3.65, end: 4.05, probability: 0.97 },
  { word: "חלב.", start: 4.44, end: 4.95, probability: 0.96 },
];

function setup(overrides: Partial<React.ComponentProps<typeof TranscriptWordStrip>> = {}) {
  const onSeek = vi.fn();
  const onMarkRange = vi.fn();
  const onPreviewRange = vi.fn();
  const utils = render(
    <TranscriptWordStrip
      words={WORDS}
      currentTime={0}
      durationSec={5}
      onSeek={onSeek}
      onMarkRange={onMarkRange}
      onPreviewRange={onPreviewRange}
      {...overrides}
    />,
  );
  return { onSeek, onMarkRange, onPreviewRange, ...utils };
}

const wordAt = (index: number) => document.querySelector(`[data-word-index="${index}"]`) as HTMLElement;

afterEach(cleanup);

describe("הצגת המילים", () => {
  it("כל המילים מוצגות", () => {
    setup();
    expect(document.querySelectorAll("[data-word-index]")).toHaveLength(WORDS.length);
    expect(screen.getByText("הכדירה")).toBeInTheDocument();
    expect(screen.getByText("חלב.")).toBeInTheDocument();
  });

  it("בלי מילים הרצועה אינה מוצגת בכלל", () => {
    render(<TranscriptWordStrip words={[]} currentTime={0} durationSec={5} onSeek={vi.fn()} onMarkRange={vi.fn()} />);
    expect(screen.queryByTestId("transcript-word-strip")).not.toBeInTheDocument();
  });

  it("המילה הנאמרת מסומנת לפי זמן הנגן", () => {
    setup({ currentTime: 1.2 });
    expect(wordAt(2).dataset.active).toBe("true");
    expect(wordAt(1).dataset.active).toBe("false");
  });

  it("מילה שהמנוע לא היה בטוח בה מסומנת בקו מקווקו", () => {
    setup();
    expect(wordAt(4).className).toContain("decoration-dotted");
    expect(wordAt(5).className).not.toContain("decoration-dotted");
  });

  it("מילים שנמצאות בתוך אזור שסומן לחיתוך נראות מסומנות", () => {
    setup({ markedRanges: [{ startSec: 3.4, endSec: 4.1 }] });
    expect(wordAt(4).dataset.marked).toBe("true");
    expect(wordAt(5).dataset.marked).toBe("true");
    expect(wordAt(0).dataset.marked).toBe("false");
  });

  it("הזמן של כל מילה מופיע בחלונית העזרה שלה", () => {
    setup();
    expect(wordAt(2).getAttribute("title")).toBe("0:01.0 — 0:01.5");
  });
});

describe("לחיצה על מילה מקפיצה את הנגן", () => {
  it("הנגן נשלח לזמן ההתחלה של המילה", () => {
    const { onSeek } = setup();
    fireEvent.pointerDown(wordAt(3), { button: 0 });
    expect(onSeek).toHaveBeenCalledWith(2.0);
  });

  it("לחיצה בכפתור ימני לא עושה כלום", () => {
    const { onSeek } = setup();
    fireEvent.pointerDown(wordAt(3), { button: 2 });
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("לחיצה אחת מסמנת את המילה הזאת בלבד", () => {
    setup();
    fireEvent.pointerDown(wordAt(3), { button: 0 });
    expect(wordAt(3).dataset.selected).toBe("true");
    expect(wordAt(2).dataset.selected).toBe("false");
    expect(wordAt(4).dataset.selected).toBe("false");
  });
});

describe("סימון קטע", () => {
  it("גרירה על כמה מילים מסמנת את כולן", () => {
    setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.pointerEnter(wordAt(2));
    fireEvent.pointerEnter(wordAt(3));
    expect(wordAt(1).dataset.selected).toBe("true");
    expect(wordAt(2).dataset.selected).toBe("true");
    expect(wordAt(3).dataset.selected).toBe("true");
    expect(wordAt(4).dataset.selected).toBe("false");
  });

  it("אחרי שהעכבר שוחרר, מעבר על מילה אינו מרחיב את הסימון", () => {
    setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.pointerEnter(wordAt(4));
    expect(wordAt(4).dataset.selected).toBe("false");
  });

  it("לחיצה עם Shift מרחיבה מהמילה הראשונה שנבחרה", () => {
    setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.pointerDown(wordAt(5), { button: 0, shiftKey: true });
    expect(wordAt(1).dataset.selected).toBe("true");
    expect(wordAt(5).dataset.selected).toBe("true");
    expect(wordAt(6).dataset.selected).toBe("false");
  });

  it("סימון לאחור עובד — מהמילה המאוחרת אל המוקדמת", () => {
    setup();
    fireEvent.pointerDown(wordAt(5), { button: 0 });
    fireEvent.pointerEnter(wordAt(3));
    expect(wordAt(3).dataset.selected).toBe("true");
    expect(wordAt(4).dataset.selected).toBe("true");
    expect(wordAt(5).dataset.selected).toBe("true");
  });

  it("לחיצה כפולה מסמנת את המשפט כולו", () => {
    setup();
    fireEvent.doubleClick(wordAt(1));
    // המשפט הראשון נגמר ב"לפגם." — מילים 0 עד 3
    expect(wordAt(0).dataset.selected).toBe("true");
    expect(wordAt(3).dataset.selected).toBe("true");
    expect(wordAt(4).dataset.selected).toBe("false");
  });

  it("Shift עם חץ שמאלה מרחיב את הסימון קדימה בטקסט", () => {
    setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.pointerUp(window);
    fireEvent.keyDown(wordAt(1), { key: "ArrowLeft", shiftKey: true });
    expect(wordAt(2).dataset.selected).toBe("true");
  });

  it("Escape מבטל את הסימון", () => {
    setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    expect(screen.getByTestId("word-selection-bar")).toBeInTheDocument();
    fireEvent.keyDown(wordAt(1), { key: "Escape" });
    expect(screen.queryByTestId("word-selection-bar")).not.toBeInTheDocument();
  });
});

describe("מה נשלח לחיתוך", () => {
  it("הטווח הוא מתחילת המילה הראשונה עד סוף האחרונה", () => {
    const { onMarkRange } = setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.pointerEnter(wordAt(3));
    fireEvent.click(screen.getByTestId("mark-selection"));
    expect(onMarkRange).toHaveBeenCalledTimes(1);
    const range = onMarkRange.mock.calls[0][0];
    expect(range.startSec).toBeCloseTo(0.55, 5);
    expect(range.endSec).toBeCloseTo(2.6, 5);
    expect(range.label).toBe("חז״ל אסרו, לפגם.");
  });

  it("אחרי הסימון לחיתוך, הסימון הזמני מתנקה", () => {
    setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.click(screen.getByTestId("mark-selection"));
    expect(screen.queryByTestId("word-selection-bar")).not.toBeInTheDocument();
  });

  it("אורך הקטע מוצג למשתמש לפני החיתוך", () => {
    setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.pointerEnter(wordAt(3));
    expect(screen.getByText("2.05 שניות")).toBeInTheDocument();
  });

  it("השמעה מקדימה שולחת את אותו טווח, בלי לחתוך", () => {
    const { onPreviewRange, onMarkRange } = setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.pointerEnter(wordAt(3));
    fireEvent.click(screen.getByTestId("preview-selection"));
    expect(onPreviewRange).toHaveBeenCalledTimes(1);
    expect(onPreviewRange.mock.calls[0][0].endSec).toBeCloseTo(2.6, 5);
    expect(onMarkRange).not.toHaveBeenCalled();
  });

  it("הטווח אינו חורג מאורך הקובץ", () => {
    const onMarkRange = vi.fn();
    render(
      <TranscriptWordStrip
        words={WORDS}
        currentTime={0}
        durationSec={4.5}
        onSeek={vi.fn()}
        onMarkRange={onMarkRange}
      />,
    );
    // המילה האחרונה נגמרת ב-4.95, אבל הקובץ נגמר ב-4.5
    fireEvent.pointerDown(wordAt(6), { button: 0 });
    fireEvent.click(screen.getByTestId("mark-selection"));
    expect(onMarkRange.mock.calls[0][0].endSec).toBe(4.5);
  });

  it("כפתור מחק מבקש מחיקה, לא סימון סתם", () => {
    const { onMarkRange } = setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.click(screen.getByTestId("delete-selection"));
    expect(onMarkRange).toHaveBeenCalledTimes(1);
    expect(onMarkRange.mock.calls[0][1]).toBe("remove");
  });

  it("כפתור ייצא מבקש ייצוא", () => {
    const { onMarkRange } = setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.click(screen.getByTestId("export-selection"));
    expect(onMarkRange.mock.calls[0][1]).toBe("keep");
  });

  it("סימון בלבד אינו קובע מה לעשות עם הקטע", () => {
    const { onMarkRange } = setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.click(screen.getByTestId("mark-selection"));
    expect(onMarkRange.mock.calls[0][1]).toBeUndefined();
  });

  it("מחיקה וייצוא שולחים בדיוק את הטווח שסומן", () => {
    const { onMarkRange } = setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.pointerEnter(wordAt(3));
    fireEvent.click(screen.getByTestId("delete-selection"));
    const range = onMarkRange.mock.calls[0][0];
    expect(range.startSec).toBeCloseTo(0.55, 5);
    expect(range.endSec).toBeCloseTo(2.6, 5);
  });

  it("אחרי מחיקה הסימון הזמני מתנקה, ואפשר לסמן קטע נוסף", () => {
    const { onMarkRange } = setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.click(screen.getByTestId("delete-selection"));
    expect(screen.queryByTestId("word-selection-bar")).not.toBeInTheDocument();

    fireEvent.pointerDown(wordAt(5), { button: 0 });
    fireEvent.click(screen.getByTestId("delete-selection"));
    expect(onMarkRange).toHaveBeenCalledTimes(2);
  });

  it("בלי בחירה אין שורת פעולות", () => {
    setup();
    expect(screen.queryByTestId("word-selection-bar")).not.toBeInTheDocument();
  });

  it("כפתור הביטול מסיר את הבחירה", () => {
    setup();
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.click(screen.getByTestId("clear-selection"));
    expect(screen.queryByTestId("word-selection-bar")).not.toBeInTheDocument();
  });
});
