import { describe, it, expect } from "vitest";
import { isTranscriptionServerError } from "./serverErrorRules";

describe("זיהוי שגיאה ששייכת לשרת התמלול", () => {
  it("מזהה לפי המקור ביומן", () => {
    expect(isTranscriptionServerError("CUDA", "transcribeStream error")).toBe(true);
    expect(isTranscriptionServerError("CUDA Server", "משהו")).toBe(true);
    expect(isTranscriptionServerError("CUDA-SSE", "משהו")).toBe(true);
    expect(isTranscriptionServerError("LocalServer", "משהו")).toBe(true);
  });

  it("מזהה לפי ההודעה, גם כשהמקור אינו מסומן", () => {
    // שתי אלה נצפו ביומן אמיתי
    expect(isTranscriptionServerError("Proxy", "Whisper server unavailable on port 3000")).toBe(true);
    expect(isTranscriptionServerError("Net", "Failed to fetch")).toBe(true);
    expect(isTranscriptionServerError("Net", "connect ECONNREFUSED 127.0.0.1:3000")).toBe(true);
    expect(isTranscriptionServerError("App", "שרת התמלול אינו זמין")).toBe(true);
  });

  /*
    זה לב התיקון. הכלל הישן תפס כל הודעה שבה המילה "server" או
    "connection", ולכן שגיאות שאין להן קשר לשרת התמלול הרימו התראה
    "שרת התמלול אינו מגיב" — ושלחו לחפש במקום הלא נכון.
  */
  it("אינו תופס שגיאות שאין להן קשר לשרת התמלול", () => {
    expect(isTranscriptionServerError("Cloud", "Supabase server returned 500")).toBe(false);
    expect(isTranscriptionServerError("Auth", "connection to identity provider lost")).toBe(false);
    expect(isTranscriptionServerError("Promise", "Unhandled rejection: signal is aborted")).toBe(false);
    expect(isTranscriptionServerError("Global", "ReferenceError: Sheet is not defined")).toBe(false);
    expect(isTranscriptionServerError("Render", "Cannot read properties of undefined")).toBe(false);
  });

  it("אינו קורס על ערכים חסרים", () => {
    expect(isTranscriptionServerError("", "")).toBe(false);
    expect(isTranscriptionServerError("", undefined as unknown as string)).toBe(false);
  });

  it("אינו תלוי באותיות גדולות או קטנות", () => {
    expect(isTranscriptionServerError("X", "WHISPER SERVER UNAVAILABLE on port 3000")).toBe(true);
    expect(isTranscriptionServerError("X", "TranscribeStream Error")).toBe(true);
  });
});
