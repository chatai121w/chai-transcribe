import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerPlayer,
  claimPlayback,
  releasePlayback,
  playingNow,
  stopAll,
  resetPlayers,
  registeredCount,
} from "./activeAudio";

beforeEach(() => resetPlayers());

describe("נגן אחד מתנגן בכל רגע", () => {
  it("הפעלת נגן עוצרת את כל האחרים", () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    const stopC = vi.fn();
    registerPlayer("א", stopA);
    registerPlayer("ב", stopB);
    registerPlayer("ג", stopC);

    claimPlayback("ב");

    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopC).toHaveBeenCalledTimes(1);
    // מי שהתחיל לנגן אינו עוצר את עצמו
    expect(stopB).not.toHaveBeenCalled();
    expect(playingNow()).toBe("ב");
  });

  it("מעבר מנגן לנגן עוצר את הקודם", () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    registerPlayer("א", stopA);
    registerPlayer("ב", stopB);

    claimPlayback("א");
    expect(playingNow()).toBe("א");

    claimPlayback("ב");
    expect(stopA).toHaveBeenCalledTimes(1);
    expect(playingNow()).toBe("ב");
  });

  it("נגן שנכשל בעצירה אינו מונע מהשאר לעצור", () => {
    const broken = vi.fn(() => { throw new Error("נכשל"); });
    const ok = vi.fn();
    registerPlayer("שבור", broken);
    registerPlayer("תקין", ok);

    expect(() => claimPlayback("חדש")).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("נגן שהפסיק מיוזמתו מנקה את הסימון", () => {
    registerPlayer("א", vi.fn());
    claimPlayback("א");
    releasePlayback("א");
    expect(playingNow()).toBeNull();
  });

  it("הפסקה של נגן אחר אינה מבטלת את מי שמתנגן", () => {
    registerPlayer("א", vi.fn());
    registerPlayer("ב", vi.fn());
    claimPlayback("א");
    releasePlayback("ב");
    expect(playingNow()).toBe("א");
  });

  it("עצירת הכול עוצרת את כולם", () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    registerPlayer("א", stopA);
    registerPlayer("ב", stopB);
    claimPlayback("א");
    // ההפעלה כבר עצרה את ב' פעם אחת; סופרים מכאן
    stopA.mockClear();
    stopB.mockClear();

    stopAll();

    expect(stopA).toHaveBeenCalledTimes(1);
    expect(stopB).toHaveBeenCalledTimes(1);
    expect(playingNow()).toBeNull();
  });
});

describe("הסרת נגן מהרישום", () => {
  it("נגן שהוסר אינו נעצר יותר, ואינו נשאר בזיכרון", () => {
    const stopA = vi.fn();
    const remove = registerPlayer("א", stopA);
    registerPlayer("ב", vi.fn());
    expect(registeredCount()).toBe(2);

    remove();
    expect(registeredCount()).toBe(1);

    claimPlayback("ב");
    expect(stopA).not.toHaveBeenCalled();
  });

  it("הסרת הנגן שמתנגן מנקה את הסימון", () => {
    const remove = registerPlayer("א", vi.fn());
    claimPlayback("א");
    remove();
    expect(playingNow()).toBeNull();
  });

  it("רישום חוזר של אותו מזהה מחליף את הקודם ואינו מכפיל", () => {
    const old = vi.fn();
    const fresh = vi.fn();
    registerPlayer("א", old);
    registerPlayer("א", fresh);
    expect(registeredCount()).toBe(1);

    claimPlayback("אחר");
    expect(old).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });
});
