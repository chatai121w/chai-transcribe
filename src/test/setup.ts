import '@testing-library/jest-dom';

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = ResizeObserverMock;

/**
 * סביבת הבדיקות אינה מממשת גלילה.
 *
 * רכיב שקורא לגלילה — למשל כדי להביא את המילה הנאמרת למרכז —
 * קורס שם בשגיאה שאינה קשורה למה שנבדק. ההשלמה הזאת היא ריקה
 * בכוונה: הגלילה עצמה אינה מה שנבדק, רק שהיא אינה מפילה.
 */
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (typeof window !== 'undefined' && !window.scrollTo) {
  window.scrollTo = function scrollTo() {};
}
