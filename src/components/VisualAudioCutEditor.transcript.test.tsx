import { cleanup, fireEvent, render, screen, act, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CutWord } from "@/lib/transcriptCut";

/**
 * החיבור בין הטקסט לחיתוך.
 *
 * הבדיקות למעלה בודקות את החשבון ואת הרצועה בנפרד. כאן נבדק מה
 * שבאמת מגיע למנוע החיתוך: לחיצה על מילה מזיזה את הנגן, וסימון
 * משפט יוצר אזור חיתוך בזמנים הנכונים — אחרי ההצמדה לשקט.
 *
 * האודיו המלאכותי בנוי כך שההצמדה תהיה מורגשת:
 *   0.0–0.2  שקט
 *   0.2–1.0  דיבור
 *   1.0–1.4  שקט
 *   1.4–3.0  דיבור
 * זמן סיום המילה נקבע בכוונה ב-1.1 — בתוך השקט אבל לא בסופו,
 * בדיוק הטעות שמנוע התמלול עושה במציאות.
 */

/**
 * סביבת הבדיקות אינה מממשת כתובת זמנית לקובץ. רכיב הגל יוצר כזאת
 * כדי לטעון את האודיו, ובלעדיה הוא קורס על דבר שאינו נבדק כאן.
 */
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:test";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}

const SAMPLE_RATE = 8000;

function buildChannel(): Float32Array {
  const blocks: Array<[number, number, number]> = [
    [0.0, 0.2, 0],
    [0.2, 1.0, 0.4],
    [1.0, 1.4, 0],
    [1.4, 3.0, 0.4],
  ];
  const samples = new Float32Array(Math.round(3.0 * SAMPLE_RATE));
  for (const [from, to, amplitude] of blocks) {
    const start = Math.round(from * SAMPLE_RATE);
    const end = Math.round(to * SAMPLE_RATE);
    for (let i = start; i < end; i += 1) {
      samples[i] = i % 2 === 0 ? amplitude : -amplitude;
    }
  }
  return samples;
}

const mocks = vi.hoisted(() => {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const addRegion = vi.fn((options: { start: number; end: number }) => ({
    id: `region-${options.start.toFixed(3)}`,
    start: options.start,
    end: options.end,
    setOptions: vi.fn(),
    remove: vi.fn(),
    play: vi.fn(),
  }));
  const regionHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const regions = {
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      (regionHandlers[event] ||= []).push(callback);
    }),
    enableDragSelection: vi.fn(() => () => {}),
    getRegions: vi.fn((): Array<Record<string, unknown>> => []),
    addRegion,
    clearRegions: vi.fn(),
  };
  const wavesurfer = {
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      (handlers[event] ||= []).push(callback);
      return () => {};
    }),
    zoom: vi.fn(),
    setTime: vi.fn(),
    play: vi.fn(),
    playPause: vi.fn(),
    setVolume: vi.fn(),
    getCurrentTime: vi.fn(() => 0),
    getDecodedData: vi.fn(),
    load: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(),
  };
  return { handlers, regionHandlers, regions, wavesurfer, addRegion };
});

/** אזור מזויף שמתנהג כמו אזור אמיתי מספיק בשביל העורך. */
function fakeRegion(id: string, start: number, end: number) {
  return { id, start, end, setOptions: vi.fn(), remove: vi.fn(), play: vi.fn() };
}

vi.mock("wavesurfer.js", () => ({
  default: { create: vi.fn(() => mocks.wavesurfer) },
}));
vi.mock("wavesurfer.js/dist/plugins/regions.esm.js", () => ({
  default: { create: vi.fn(() => mocks.regions) },
}));
vi.mock("wavesurfer.js/dist/plugins/timeline.esm.js", () => ({
  default: { create: vi.fn(() => ({})) },
}));

const { default: VisualAudioCutEditor } = await import("./VisualAudioCutEditor");

const WORDS: CutWord[] = [
  { word: "הכדירה", start: 0.25, end: 1.10, probability: 0.95 },
  { word: "חז״ל", start: 1.45, end: 2.00, probability: 0.98 },
  { word: "אסרו.", start: 2.05, end: 2.90, probability: 0.93 },
];

function fire(event: string, ...args: unknown[]) {
  act(() => {
    (mocks.handlers[event] || []).forEach((callback) => callback(...args));
  });
}

/** מדמה שרכיב הגל מחזיק כעת את האזורים האלה, ומודיע על כך לעורך. */
function setRegions(list: Array<{ id: string; start: number; end: number }>) {
  mocks.regions.getRegions.mockReturnValue(
    list.map((r) => fakeRegion(r.id, r.start, r.end)),
  );
  act(() => {
    (mocks.regionHandlers['region-updated'] || []).forEach((callback) => callback());
  });
}

function renderEditor(words?: CutWord[]) {
  const onPlanChange = vi.fn();
  const file = new File(["x"], "shiur.mp3", { type: "audio/mpeg" });
  const utils = render(
    <VisualAudioCutEditor file={file} durationSec={3} onPlanChange={onPlanChange} words={words} />,
  );
  return { onPlanChange, ...utils };
}

const wordAt = (index: number) => document.querySelector(`[data-word-index="${index}"]`) as HTMLElement;

beforeEach(() => {
  Object.keys(mocks.handlers).forEach((key) => delete mocks.handlers[key]);
  Object.keys(mocks.regionHandlers).forEach((key) => delete mocks.regionHandlers[key]);
  mocks.regions.getRegions.mockReturnValue([]);
  mocks.wavesurfer.setTime.mockClear();
  mocks.wavesurfer.play.mockClear();
  mocks.addRegion.mockClear();
  mocks.wavesurfer.getDecodedData.mockReturnValue({
    numberOfChannels: 1,
    sampleRate: SAMPLE_RATE,
    getChannelData: () => buildChannel(),
  });
});

afterEach(cleanup);

describe("מתי רצועת המילים מופיעה", () => {
  it("בלי תמלול אין רצועת מילים — העורך נשאר כמו שהיה", () => {
    renderEditor();
    fire("ready");
    expect(screen.queryByTestId("transcript-cut-area")).not.toBeInTheDocument();
    expect(screen.getByTestId("waveform-selection-area")).toBeInTheDocument();
  });

  it("עם תמלול הרצועה מופיעה עם כל המילים", () => {
    renderEditor(WORDS);
    fire("ready");
    expect(screen.getByTestId("transcript-cut-area")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-word-index]")).toHaveLength(3);
  });

  it("מפתח ההצמדה לשקט נדלק רק אחרי שהאודיו פוענח", async () => {
    renderEditor(WORDS);
    expect(screen.getByTestId("snap-toggle")).toBeDisabled();
    fire("ready");
    await waitFor(() => expect(screen.getByTestId("snap-toggle")).not.toBeDisabled());
  });

  it("אודיו שלא פוענח לא מפיל את העורך — רק ההצמדה כבויה", async () => {
    mocks.wavesurfer.getDecodedData.mockReturnValue(null);
    renderEditor(WORDS);
    fire("ready");
    await waitFor(() => expect(screen.getByTestId("snap-toggle")).toBeDisabled());
    expect(screen.getByTestId("transcript-cut-area")).toBeInTheDocument();
  });
});

describe("לחיצה על מילה מזיזה את הנגן", () => {
  it("הנגן נשלח בדיוק לזמן ההתחלה של המילה", () => {
    renderEditor(WORDS);
    fire("ready");
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    expect(mocks.wavesurfer.setTime).toHaveBeenCalledWith(1.45);
  });

  it("זמן שמעבר לאורך הקובץ נחתך לגבול", () => {
    renderEditor([{ word: "מאוחרת", start: 99, end: 100 }]);
    fire("ready");
    fireEvent.pointerDown(wordAt(0), { button: 0 });
    expect(mocks.wavesurfer.setTime).toHaveBeenCalledWith(3);
  });

  it("המילה הנאמרת מתעדכנת לפי הזמן שהנגן מדווח", () => {
    renderEditor(WORDS);
    fire("ready");
    fire("timeupdate", 1.6);
    expect(wordAt(1).dataset.active).toBe("true");
    expect(wordAt(0).dataset.active).toBe("false");
  });
});

describe("סימון משפט הופך לאזור חיתוך", () => {
  it("הקצוות מוזזים לרגע השקט, לא לזמן שהמנוע נתן", async () => {
    renderEditor(WORDS);
    fire("ready");
    await waitFor(() => expect(screen.getByTestId("snap-toggle")).not.toBeDisabled());

    // מסמנים רק את המילה הראשונה: 0.25 עד 1.10
    fireEvent.pointerDown(wordAt(0), { button: 0 });
    fireEvent.click(screen.getByTestId("mark-selection"));

    expect(mocks.addRegion).toHaveBeenCalledTimes(1);
    const { start, end } = mocks.addRegion.mock.calls[0][0];
    // ההתחלה נמשכה אחורה אל השקט שלפני הדיבור
    expect(start).toBeLessThan(0.25);
    expect(start).toBeLessThanOrEqual(0.2);
    // הסוף נדחה קדימה אל סוף השקט, כדי לא לבלוע את ההמשך
    expect(end).toBeGreaterThan(1.1);
    expect(end).toBeLessThanOrEqual(1.45);
  });

  it("המשתמש מקבל הודעה בכמה הוזזו הקצוות", async () => {
    renderEditor(WORDS);
    fire("ready");
    await waitFor(() => expect(screen.getByTestId("snap-toggle")).not.toBeDisabled());
    fireEvent.pointerDown(wordAt(0), { button: 0 });
    fireEvent.click(screen.getByTestId("mark-selection"));
    expect(screen.getByTestId("snap-note").textContent).toContain("הוזזו לשקט");
  });

  it("כשמכבים את ההצמדה, החיתוך הוא בדיוק בזמני המילים", async () => {
    renderEditor(WORDS);
    fire("ready");
    await waitFor(() => expect(screen.getByTestId("snap-toggle")).not.toBeDisabled());

    fireEvent.click(screen.getByTestId("snap-toggle"));
    fireEvent.pointerDown(wordAt(0), { button: 0 });
    fireEvent.click(screen.getByTestId("mark-selection"));

    const { start, end } = mocks.addRegion.mock.calls[0][0];
    expect(start).toBeCloseTo(0.25, 5);
    expect(end).toBeCloseTo(1.1, 5);
  });

  it("סימון של כמה מילים נותן אזור אחד מההתחלה עד הסוף", async () => {
    renderEditor(WORDS);
    fire("ready");
    await waitFor(() => expect(screen.getByTestId("snap-toggle")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("snap-toggle"));

    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.pointerEnter(wordAt(2));
    fireEvent.click(screen.getByTestId("mark-selection"));

    expect(mocks.addRegion).toHaveBeenCalledTimes(1);
    const { start, end } = mocks.addRegion.mock.calls[0][0];
    expect(start).toBeCloseTo(1.45, 5);
    expect(end).toBeCloseTo(2.9, 5);
  });

  it("האזור נוצר כאזור שאפשר להזיז ולמתוח, כמו סימון בגרירה", async () => {
    renderEditor(WORDS);
    fire("ready");
    fireEvent.pointerDown(wordAt(0), { button: 0 });
    fireEvent.click(screen.getByTestId("mark-selection"));
    const options = mocks.addRegion.mock.calls[0][0] as Record<string, unknown>;
    expect(options.drag).toBe(true);
    expect(options.resize).toBe(true);
  });
});

describe("מחיקה וייצוא מתוך הטקסט", () => {
  it("לחיצה על מחק מעבירה את העורך למצב הסרה", async () => {
    renderEditor(WORDS);
    fire("ready");
    fireEvent.pointerDown(wordAt(0), { button: 0 });
    fireEvent.click(screen.getByTestId("delete-selection"));

    const removeMode = screen.getByRole("radio", { name: /הסר את המסומן/ });
    await waitFor(() => expect(removeMode).toHaveAttribute("aria-checked", "true"));
    expect(mocks.addRegion).toHaveBeenCalledTimes(1);
  });

  it("לחיצה על ייצא מעבירה את העורך למצב שמירת המסומן", async () => {
    renderEditor(WORDS);
    fire("ready");
    // קודם מעבירים למצב אחר, כדי שהשינוי יהיה מורגש
    fireEvent.click(screen.getByRole("radio", { name: /פצל ושמור את הכול/ }));
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.click(screen.getByTestId("export-selection"));

    const keepMode = screen.getByRole("radio", { name: /שמור רק את המסומן/ });
    await waitFor(() => expect(keepMode).toHaveAttribute("aria-checked", "true"));
  });

  it("סימון בלבד אינו משנה את מצב העורך", () => {
    renderEditor(WORDS);
    fire("ready");
    fireEvent.click(screen.getByRole("radio", { name: /פצל ושמור את הכול/ }));
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.click(screen.getByTestId("mark-selection"));
    expect(screen.getByRole("radio", { name: /פצל ושמור את הכול/ })).toHaveAttribute("aria-checked", "true");
  });

  it("אפשר לסמן כמה קטעים זה אחר זה", () => {
    renderEditor(WORDS);
    fire("ready");
    fireEvent.pointerDown(wordAt(0), { button: 0 });
    fireEvent.click(screen.getByTestId("delete-selection"));
    fireEvent.pointerDown(wordAt(2), { button: 0 });
    fireEvent.click(screen.getByTestId("delete-selection"));
    expect(mocks.addRegion).toHaveBeenCalledTimes(2);
    const first = mocks.addRegion.mock.calls[0][0];
    const second = mocks.addRegion.mock.calls[1][0];
    expect(second.start).toBeGreaterThan(first.start);
  });
});

describe("חיבור הקטעים לקובץ אחד", () => {
  it("מצב מחיקה מדווח מלכתחילה שהפלט יהיה קובץ אחד", async () => {
    const { onPlanChange } = renderEditor(WORDS);
    fire("ready");
    fireEvent.click(screen.getByRole("radio", { name: /הסר את המסומן/ }));
    await waitFor(() => {
      const last = onPlanChange.mock.calls.at(-1);
      expect(last?.[1]).toBe("remove");
      expect(last?.[2]).toBe(true);
    });
  });

  it("מצב ייצוא מדווח מלכתחילה שכל קטע יישמר בנפרד", async () => {
    const { onPlanChange } = renderEditor(WORDS);
    fire("ready");
    fireEvent.click(screen.getByRole("radio", { name: /הסר את המסומן/ }));
    fireEvent.click(screen.getByRole("radio", { name: /שמור רק את המסומן/ }));
    await waitFor(() => {
      const last = onPlanChange.mock.calls.at(-1);
      expect(last?.[1]).toBe("keep");
      expect(last?.[2]).toBe(false);
    });
  });

  it("בחירת המשתמש גוברת על ברירת המחדל של המצב", async () => {
    const { onPlanChange } = renderEditor(WORDS);
    fire("ready");
    fireEvent.click(screen.getByRole("radio", { name: /שמור רק את המסומן/ }));
    // שני אזורים מסומנים, כדי שבורר החיבור יוצג
    setRegions([
      { id: "a", start: 0.2, end: 0.9 },
      { id: "b", start: 1.4, end: 2.1 },
    ]);

    const toggle = await screen.findByTestId("join-output-toggle");
    fireEvent.click(toggle);
    await waitFor(() => expect(onPlanChange.mock.calls.at(-1)?.[2]).toBe(true));
  });

  it("בורר החיבור אינו מוצג כשיש קטע אחד בלבד", () => {
    renderEditor(WORDS);
    fire("ready");
    setRegions([{ id: "a", start: 0.2, end: 0.9 }]);
    fireEvent.click(screen.getByRole("radio", { name: /שמור רק את המסומן/ }));
    expect(screen.queryByTestId("join-output-toggle")).not.toBeInTheDocument();
  });

  it("סדר הקטעים ניתן לגרירה גם בייצוא, לא רק בפיצול", () => {
    renderEditor(WORDS);
    fire("ready");
    fireEvent.click(screen.getByRole("radio", { name: /שמור רק את המסומן/ }));
    setRegions([
      { id: "a", start: 0.2, end: 0.9 },
      { id: "b", start: 1.4, end: 2.1 },
    ]);
    expect(screen.getByTestId("split-output-order")).toBeInTheDocument();
  });
});

describe("השמעה מקדימה לפני החיתוך", () => {
  it("משמיעה בדיוק את הקטע שסומן, ולא חותכת כלום", () => {
    renderEditor(WORDS);
    fire("ready");
    fireEvent.pointerDown(wordAt(1), { button: 0 });
    fireEvent.click(screen.getByTestId("preview-selection"));
    expect(mocks.wavesurfer.play).toHaveBeenCalledWith(1.45, 2.0);
    expect(mocks.addRegion).not.toHaveBeenCalled();
  });
});
