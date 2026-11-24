import { describe, it, expect } from "vitest";
import { isAudioOrVideo, filterMediaFiles, mediaFilesFromDrop } from "./mediaFiles";

function makeFile(name: string, type = ""): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("זיהוי קובץ אודיו או וידאו", () => {
  it("מזהה לפי סוג הקובץ שהדפדפן מדווח", () => {
    expect(isAudioOrVideo(makeFile("שיעור", "audio/mpeg"))).toBe(true);
    expect(isAudioOrVideo(makeFile("שיעור", "video/mp4"))).toBe(true);
  });

  it("מזהה לפי הסיומת כשהדפדפן לא מדווח סוג", () => {
    expect(isAudioOrVideo(makeFile("שיעור.m4a"))).toBe(true);
    expect(isAudioOrVideo(makeFile("שיעור.OPUS"))).toBe(true);
    expect(isAudioOrVideo(makeFile("שיעור.MKV"))).toBe(true);
  });

  it("דוחה מה שאינו אודיו או וידאו", () => {
    expect(isAudioOrVideo(makeFile("הערות.txt", "text/plain"))).toBe(false);
    expect(isAudioOrVideo(makeFile("תמונה.png", "image/png"))).toBe(false);
    expect(isAudioOrVideo(makeFile("בלי-סיומת"))).toBe(false);
  });

  it("אינו מתבלבל מנקודה בתוך שם הקובץ", () => {
    expect(isAudioOrVideo(makeFile("שיעור 3.5 בבא קמא.mp3"))).toBe(true);
    expect(isAudioOrVideo(makeFile("שיעור 3.5 בבא קמא.doc"))).toBe(false);
  });
});

describe("סינון רשימת קבצים", () => {
  it("משאיר רק אודיו ווידאו", () => {
    const result = filterMediaFiles([
      makeFile("ב.mp3"),
      makeFile("הערות.txt"),
      makeFile("א.wav"),
    ]);
    expect(result.map((f) => f.name)).toEqual(["א.wav", "ב.mp3"]);
  });

  it("מסדר לפי שם, כדי שסדר הקבצים לא יהיה מקרי", () => {
    const result = filterMediaFiles([makeFile("שיעור ג.mp3"), makeFile("שיעור א.mp3"), makeFile("שיעור ב.mp3")]);
    expect(result.map((f) => f.name)).toEqual(["שיעור א.mp3", "שיעור ב.mp3", "שיעור ג.mp3"]);
  });

  it("מחזיר רשימה ריקה כשאין כלום", () => {
    expect(filterMediaFiles(null)).toEqual([]);
    expect(filterMediaFiles([])).toEqual([]);
  });
});

/** בונה "רשומה" כמו שהדפדפן מגיש בגרירה. */
function fileEntry(file: File) {
  return {
    isFile: true,
    isDirectory: false,
    file: (onSuccess: (f: File) => void) => onSuccess(file),
  };
}

function folderEntry(children: unknown[]) {
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let done = false;
      return {
        readEntries: (onSuccess: (entries: unknown[]) => void) => {
          // הדפדפן מחזיר אצווה ואז רשימה ריקה שמסמנת סוף
          if (done) { onSuccess([]); return; }
          done = true;
          onSuccess(children);
        },
      };
    },
  };
}

function dropWith(entries: unknown[], files: File[] = []): DataTransfer {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files,
  } as unknown as DataTransfer;
}

describe("איסוף קבצים מגרירה", () => {
  it("אוסף קובץ בודד שנגרר", async () => {
    const result = await mediaFilesFromDrop(dropWith([fileEntry(makeFile("שיעור.mp3"))]));
    expect(result.map((f) => f.name)).toEqual(["שיעור.mp3"]);
  });

  it("נכנס לתוך תיקייה שנגררה ואוסף את כל מה שבתוכה", async () => {
    const drop = dropWith([
      folderEntry([
        fileEntry(makeFile("ב.mp3")),
        fileEntry(makeFile("קרא אותי.txt")),
        fileEntry(makeFile("א.wav")),
      ]),
    ]);
    const result = await mediaFilesFromDrop(drop);
    expect(result.map((f) => f.name)).toEqual(["א.wav", "ב.mp3"]);
  });

  it("נכנס גם לתיקייה בתוך תיקייה", async () => {
    const drop = dropWith([
      folderEntry([
        fileEntry(makeFile("חיצוני.mp3")),
        folderEntry([fileEntry(makeFile("פנימי.mp3"))]),
      ]),
    ]);
    const result = await mediaFilesFromDrop(drop);
    expect(result.map((f) => f.name)).toEqual(["חיצוני.mp3", "פנימי.mp3"]);
  });

  it("אינו מחזיר את אותו קובץ פעמיים", async () => {
    const same = makeFile("שיעור.mp3");
    const result = await mediaFilesFromDrop(dropWith([fileEntry(same), fileEntry(same)]));
    expect(result).toHaveLength(1);
  });

  it("נופל לרשימת הקבצים הרגילה כשאין תמיכה ברשומות", async () => {
    const transfer = { items: null, files: [makeFile("שיעור.mp3"), makeFile("הערות.txt")] } as unknown as DataTransfer;
    const result = await mediaFilesFromDrop(transfer);
    expect(result.map((f) => f.name)).toEqual(["שיעור.mp3"]);
  });

  it("מחזיר ריק כשלא נגרר כלום", async () => {
    expect(await mediaFilesFromDrop(null)).toEqual([]);
  });

  it("אינו קורס על תיקייה שהדפדפן מסרב לפתוח", async () => {
    const broken = { isFile: false, isDirectory: true, createReader: undefined };
    const result = await mediaFilesFromDrop(dropWith([broken, fileEntry(makeFile("שיעור.mp3"))]));
    expect(result.map((f) => f.name)).toEqual(["שיעור.mp3"]);
  });
});
