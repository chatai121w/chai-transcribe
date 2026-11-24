import { describe, it, expect } from "vitest";
import {
  nextPollDelayMs,
  checkTimeoutMs,
  msUntilSettled,
  POLL_UP_MS,
  POLL_DOWN_MS,
  RETRY_STEPS_MS,
  FIRST_CHECK_TIMEOUT_MS,
  CHECK_TIMEOUT_MS,
} from "./serverPollSchedule";

describe("מתי בודקים שוב את השרת", () => {
  it("כשהשרת עונה — בדיקה רגועה", () => {
    expect(nextPollDelayMs(0)).toBe(POLL_UP_MS);
  });

  it("כישלון ראשון נבדק שוב מהר, ולא אחרי דקה", () => {
    // זה הלב של התיקון: בלי זה המחוון מראה "שרת כבוי" דקה שלמה
    expect(nextPollDelayMs(1)).toBe(3_000);
    expect(nextPollDelayMs(1)).toBeLessThan(POLL_DOWN_MS);
  });

  it("ההמתנות מתארכות בהדרגה", () => {
    const delays = [1, 2, 3].map(nextPollDelayMs);
    expect(delays).toEqual([...RETRY_STEPS_MS]);
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it("אחרי שהכישלון הוכח — מתייצבים על בדיקה נדירה", () => {
    expect(nextPollDelayMs(4)).toBe(POLL_DOWN_MS);
    expect(nextPollDelayMs(50)).toBe(POLL_DOWN_MS);
  });

  it("מספר שלילי אינו מפיל כלום", () => {
    expect(nextPollDelayMs(-3)).toBe(POLL_UP_MS);
  });

  it("שרת שבאמת כבוי מגיע למצב קבוע לפני שהיה עובר סבב בדיקה נדיר אחד", () => {
    // שלוש בדיקות חוזרות = 31 שניות, במקום דקה שלמה של המתנה אחת
    expect(msUntilSettled()).toBe(31_000);
    expect(msUntilSettled()).toBeLessThan(POLL_DOWN_MS);
  });
});

describe("כמה זמן נותנים לבדיקה אחת", () => {
  it("הבדיקה הראשונה מקבלת יותר זמן, כי הדף עוד נטען", () => {
    expect(checkTimeoutMs(0)).toBe(FIRST_CHECK_TIMEOUT_MS);
    expect(checkTimeoutMs(0)).toBeGreaterThan(checkTimeoutMs(1));
  });

  it("בדיקה שוטפת אינה מחכה לנצח", () => {
    expect(checkTimeoutMs(1)).toBe(CHECK_TIMEOUT_MS);
    expect(checkTimeoutMs(9)).toBe(CHECK_TIMEOUT_MS);
  });
});
