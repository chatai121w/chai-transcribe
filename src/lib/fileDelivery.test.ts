import { describe, it, expect, vi, afterEach } from "vitest";
import {
  safeFileName,
  uniqueName,
  canShareFiles,
  shareFiles,
  saveFilesToFolder,
  type DirectoryHandleLike,
} from "./fileDelivery";

function makeFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "audio/wav" });
}

describe("שם קובץ בטוח לכתיבה בתיקייה", () => {
  it("מחליף תווים שמערכת הקבצים אוסרת", () => {
    expect(safeFileName('שיעור: בבא קמא/ג"ה*?.wav')).toBe("שיעור- בבא קמא-ג-ה--.wav");
  });

  it("משאיר שם עברי תקין כמו שהוא", () => {
    expect(safeFileName("שיעור 3 - בבא קמא.wav")).toBe("שיעור 3 - בבא קמא.wav");
  });

  it("מוריד נקודות בסוף, שנבלעות במערכת הקבצים", () => {
    expect(safeFileName("שיעור...")).toBe("שיעור");
  });

  it("מחזיר שם חלופי כששום דבר לא נשאר", () => {
    expect(safeFileName("///")).toBe("קטע");
    expect(safeFileName("   ")).toBe("קטע");
  });

  it("קוצר שם ארוך מדי", () => {
    expect(safeFileName("א".repeat(300))).toHaveLength(120);
  });
});

describe("מניעת דריסה של קובץ קיים", () => {
  it("מחזיר את השם כמו שהוא כשהוא פנוי", () => {
    expect(uniqueName("שיעור.wav", new Set())).toBe("שיעור.wav");
  });

  it("מוסיף מספר כשהשם תפוס", () => {
    expect(uniqueName("שיעור.wav", new Set(["שיעור.wav"]))).toBe("שיעור (2).wav");
  });

  it("ממשיך לספור עד שנמצא שם פנוי", () => {
    const taken = new Set(["שיעור.wav", "שיעור (2).wav", "שיעור (3).wav"]);
    expect(uniqueName("שיעור.wav", taken)).toBe("שיעור (4).wav");
  });

  it("שומר על הסיומת במקומה", () => {
    expect(uniqueName("א.ב.wav", new Set(["א.ב.wav"]))).toBe("א.ב (2).wav");
  });
});

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    value: originalNavigator,
    configurable: true,
    writable: true,
  });
});

function setNavigator(value: unknown) {
  Object.defineProperty(globalThis, "navigator", {
    value,
    configurable: true,
    writable: true,
  });
}

describe("שיתוף קבצים", () => {
  it("אינו זמין כשהדפדפן אינו תומך", () => {
    setNavigator({});
    expect(canShareFiles([makeFile("שיעור.wav")])).toBe(false);
  });

  it("אינו זמין כשהדפדפן מסרב לשתף את הסוג הזה", () => {
    setNavigator({ share: vi.fn(), canShare: () => false });
    expect(canShareFiles([makeFile("שיעור.wav")])).toBe(false);
  });

  it("אינו זמין בלי קבצים", () => {
    setNavigator({ share: vi.fn(), canShare: () => true });
    expect(canShareFiles([])).toBe(false);
  });

  it("זמין כשהדפדפן תומך", () => {
    setNavigator({ share: vi.fn(), canShare: () => true });
    expect(canShareFiles([makeFile("שיעור.wav")])).toBe(true);
  });

  it("מעביר את הקבצים לתפריט השיתוף", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share, canShare: () => true });
    const files = [makeFile("א.wav"), makeFile("ב.wav")];

    expect(await shareFiles(files, "קטעי חיתוך")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files, title: "קטעי חיתוך" });
  });

  it("ביטול של המשתמש אינו נחשב תקלה", async () => {
    const abort = new Error("בוטל");
    abort.name = "AbortError";
    setNavigator({ share: vi.fn().mockRejectedValue(abort), canShare: () => true });

    expect(await shareFiles([makeFile("שיעור.wav")], "קטע")).toBe("cancelled");
  });

  it("מדווח על כישלון אמיתי", async () => {
    setNavigator({ share: vi.fn().mockRejectedValue(new Error("נכשל")), canShare: () => true });
    expect(await shareFiles([makeFile("שיעור.wav")], "קטע")).toBe("failed");
  });

  it("מדווח שאין תמיכה, במקום לנסות בכל זאת", async () => {
    setNavigator({});
    expect(await shareFiles([makeFile("שיעור.wav")], "קטע")).toBe("unsupported");
  });
});

/** תיקייה מדומה, שזוכרת מה נכתב לתוכה. */
function fakeFolder(name = "השיעורים שלי") {
  const written = new Map<string, Blob>();
  const handle: DirectoryHandleLike = {
    name,
    getFileHandle: async (fileName) => ({
      createWritable: async () => ({
        write: async (data: Blob) => { written.set(fileName, data); },
        close: async () => {},
      }),
    }),
  };
  return { handle, written };
}

describe("שמירה לתיקייה במחשב", () => {
  it("כותב את כל הקבצים לתיקייה שנבחרה", async () => {
    const { handle, written } = fakeFolder();
    const files = [makeFile("קטע א.wav"), makeFile("קטע ב.wav")];

    const result = await saveFilesToFolder(files, async () => handle);

    expect(result.status).toBe("saved");
    expect(result.savedCount).toBe(2);
    expect(result.folderName).toBe("השיעורים שלי");
    expect([...written.keys()]).toEqual(["קטע א.wav", "קטע ב.wav"]);
  });

  it("אינו דורס קובץ כששני קטעים נושאים אותו שם", async () => {
    const { handle, written } = fakeFolder();
    const files = [makeFile("קטע.wav"), makeFile("קטע.wav"), makeFile("קטע.wav")];

    const result = await saveFilesToFolder(files, async () => handle);

    expect(result.savedCount).toBe(3);
    expect([...written.keys()]).toEqual(["קטע.wav", "קטע (2).wav", "קטע (3).wav"]);
  });

  it("מנקה תווים אסורים משם הקובץ", async () => {
    const { handle, written } = fakeFolder();
    await saveFilesToFolder([makeFile('שיעור: חלק א/ב.wav')], async () => handle);
    expect([...written.keys()]).toEqual(["שיעור- חלק א-ב.wav"]);
  });

  it("ביטול של בחירת התיקייה אינו תקלה", async () => {
    const abort = new Error("בוטל");
    abort.name = "AbortError";
    const result = await saveFilesToFolder([makeFile("שיעור.wav")], async () => { throw abort; });

    expect(result.status).toBe("cancelled");
    expect(result.savedCount).toBe(0);
  });

  it("קובץ שנכשל אינו עוצר את השאר, ומדווח בשמו", async () => {
    const written: string[] = [];
    const handle: DirectoryHandleLike = {
      name: "תיקייה",
      getFileHandle: async (fileName) => {
        if (fileName === "שבור.wav") throw new Error("אין הרשאת כתיבה");
        return {
          createWritable: async () => ({
            write: async () => { written.push(fileName); },
            close: async () => {},
          }),
        };
      },
    };

    const result = await saveFilesToFolder(
      [makeFile("טוב א.wav"), makeFile("שבור.wav"), makeFile("טוב ב.wav")],
      async () => handle,
    );

    expect(result.savedCount).toBe(2);
    expect(result.failed).toEqual(["שבור.wav"]);
    expect(written).toEqual(["טוב א.wav", "טוב ב.wav"]);
  });

  it("מדווח שאין תמיכה כשהדפדפן אינו יודע לבחור תיקייה", async () => {
    const result = await saveFilesToFolder([makeFile("שיעור.wav")], undefined);
    expect(result.status).toBe("unsupported");
  });
});
