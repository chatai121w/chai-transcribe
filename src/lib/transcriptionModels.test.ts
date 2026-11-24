import { describe, it, expect } from "vitest";
import {
  TRANSCRIPTION_MODELS,
  DEFAULT_TRANSCRIPTION_MODEL,
  modelLabel,
  readPreferredModel,
  writePreferredModel,
  availableModels,
} from "./transcriptionModels";

describe("רשימת מנועי התמלול", () => {
  it("אין בה כפילויות", () => {
    const values = TRANSCRIPTION_MODELS.map((model) => model.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("כוללת את כל המנועים ששני המסכים הציעו, כולל היידיש המלא שהיה חסר באחד", () => {
    const values = TRANSCRIPTION_MODELS.map((model) => model.value);
    expect(values).toContain("ivrit-ai/whisper-large-v3-turbo-ct2");
    expect(values).toContain("ivrit-ai/whisper-large-v3-ct2");
    expect(values).toContain("ivrit-ai/yi-whisper-large-v3-turbo-ct2");
    expect(values).toContain("ivrit-ai/yi-whisper-large-v3-ct2");
    expect(values).toContain("large-v3-turbo");
    expect(values).toContain("large-v3");
  });

  it("לכל מנוע יש שם והסבר בעברית", () => {
    for (const model of TRANSCRIPTION_MODELS) {
      expect(model.label.trim().length).toBeGreaterThan(0);
      expect(model.hint.trim().length).toBeGreaterThan(0);
      // ההסבר חייב להיות בעברית, כי המשתמש אינו קורא אנגלית
      expect(model.hint).toMatch(/[֐-׿]/);
    }
  });

  it("ברירת המחדל היא המנוע המהיר, והיא ברשימה", () => {
    expect(DEFAULT_TRANSCRIPTION_MODEL).toBe("ivrit-ai/whisper-large-v3-turbo-ct2");
    expect(TRANSCRIPTION_MODELS.some((m) => m.value === DEFAULT_TRANSCRIPTION_MODEL)).toBe(true);
  });
});

describe("שם המנוע לתצוגה", () => {
  it("מחזיר את השם הקצר למנוע מוכר", () => {
    expect(modelLabel("ivrit-ai/whisper-large-v3-turbo-ct2")).toBe("Ivrit.ai Turbo V3");
  });

  it("מסתדר עם מנוע שאינו ברשימה", () => {
    expect(modelLabel("someone/other-model")).toBe("other-model");
    expect(modelLabel("plain-model")).toBe("plain-model");
  });

  it("אומר בעברית כשאין מנוע", () => {
    expect(modelLabel(null)).toBe("לא נבחר");
    expect(modelLabel("")).toBe("לא נבחר");
  });
});

/** אחסון מדומה, כדי לבדוק בלי לגעת באחסון האמיתי. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    read: () => Object.fromEntries(data),
  };
}

describe("המנוע המועדף", () => {
  it("מחזיר את מה שנשמר", () => {
    const store = fakeStorage({ preferred_local_model: "large-v3" });
    expect(readPreferredModel(store)).toBe("large-v3");
  });

  it("מחזיר ברירת מחדל כשאין שמירה", () => {
    expect(readPreferredModel(fakeStorage())).toBe(DEFAULT_TRANSCRIPTION_MODEL);
  });

  it("שומר במפתח המשותף, כדי שהבחירה תחול בכל המסכים", () => {
    const store = fakeStorage();
    writePreferredModel("ivrit-ai/whisper-large-v3-ct2", store);
    expect(store.read()).toEqual({ preferred_local_model: "ivrit-ai/whisper-large-v3-ct2" });
  });

  it("אינו קורס כשאין אחסון", () => {
    const broken = { getItem: () => { throw new Error("חסום"); } };
    expect(readPreferredModel(broken)).toBe(DEFAULT_TRANSCRIPTION_MODEL);
  });
});

describe("אילו מנועים להציג", () => {
  it("מציג רק את מה שכבר הורד", () => {
    const result = availableModels(["ivrit-ai/whisper-large-v3-ct2", "large-v3"]);
    expect(result.map((m) => m.value)).toEqual(["ivrit-ai/whisper-large-v3-ct2", "large-v3"]);
  });

  it("מציג הכול כשהשרת לא דיווח", () => {
    expect(availableModels(null)).toHaveLength(TRANSCRIPTION_MODELS.length);
    expect(availableModels([])).toHaveLength(TRANSCRIPTION_MODELS.length);
  });

  it("אינו משאיר רשימה ריקה כששום מנוע מוכר לא הורד", () => {
    // עדיף להציע הכול מאשר תפריט ריק שאי אפשר לבחור בו דבר
    expect(availableModels(["מנוע-לא-מוכר"])).toHaveLength(TRANSCRIPTION_MODELS.length);
  });
});
