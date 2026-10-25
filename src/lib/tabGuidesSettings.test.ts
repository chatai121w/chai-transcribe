import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  allTabGuides, countAllGuides, countSeenGuides, guidesByPage,
  isGuideDisabledEverywhere, markGuideSeen, resetAllGuides, resetPageGuides,
  setGuidesDisabledEverywhere, shouldShowGuide, unmarkGuideSeen, wasGuideSeen,
} from './tabGuides';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('קיבוץ לפי דף', () => {
  it('כל הדרכה שייכת לדף אחד בדיוק', () => {
    const total = guidesByPage().reduce((sum, p) => sum + p.guides.length, 0);
    expect(total).toBe(countAllGuides());
    expect(total).toBe(allTabGuides().length);
  });

  it('לכל דף יש שם בעברית', () => {
    // המשתמש אינו קורא אנגלית, והמזהה נשאר באותיות לטיניות.
    const hebrew = /[א-ת]/;
    for (const page of guidesByPage()) {
      expect(hebrew.test(page.label), page.pageId).toBe(true);
    }
  });

  it('אין דף ריק', () => {
    for (const page of guidesByPage()) {
      expect(page.guides.length, page.pageId).toBeGreaterThan(0);
    }
  });

  it('אין דף שמופיע פעמיים', () => {
    const ids = guidesByPage().map((p) => p.pageId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('הספירה של הנצפים מתעדכנת', () => {
    const page = guidesByPage()[0];
    expect(page.seen).toBe(0);
    markGuideSeen(page.guides[0].id);
    expect(guidesByPage()[0].seen).toBe(1);
  });
});

describe('איפוס של דף אחד', () => {
  it('מאפס רק את הדף שנבחר', () => {
    const [first, second] = guidesByPage();
    first.guides.forEach((g) => markGuideSeen(g.id));
    second.guides.forEach((g) => markGuideSeen(g.id));

    resetPageGuides(first.pageId);

    const after = guidesByPage();
    expect(after[0].seen).toBe(0);
    expect(after[1].seen).toBe(second.guides.length);
  });

  it('מזהה דף שאינו קיים אינו משנה כלום', () => {
    const page = guidesByPage()[0];
    markGuideSeen(page.guides[0].id);
    resetPageGuides('אין-דף-כזה');
    expect(countSeenGuides()).toBe(1);
  });
});

describe('איפוס הכל', () => {
  it('מנקה את כל מה שנראה', () => {
    allTabGuides().forEach((g) => markGuideSeen(g.id));
    expect(countSeenGuides()).toBe(countAllGuides());
    resetAllGuides();
    expect(countSeenGuides()).toBe(0);
  });

  it('גם מדליק את המסכים בחזרה', () => {
    // בלי זה הבקשה "הצג מחדש" הייתה מתבצעת חצי: המצב מתאפס,
    // והמשתמש עדיין לא רואה כלום.
    setGuidesDisabledEverywhere(true);
    resetAllGuides();
    expect(isGuideDisabledEverywhere()).toBe(false);
  });
});

describe('המתג הראשי', () => {
  it('כבוי מונע הצגה גם ממסך שלא נראה', () => {
    const id = allTabGuides()[0].id;
    expect(shouldShowGuide(id)).toBe(true);
    setGuidesDisabledEverywhere(true);
    expect(shouldShowGuide(id)).toBe(false);
  });

  it('דלוק מחזיר את ההצגה', () => {
    const id = allTabGuides()[0].id;
    setGuidesDisabledEverywhere(true);
    setGuidesDisabledEverywhere(false);
    expect(shouldShowGuide(id)).toBe(true);
  });

  it('ברירת המחדל היא דלוק', () => {
    expect(isGuideDisabledEverywhere()).toBe(false);
  });
});

describe('ביטול סימון של מסך בודד', () => {
  it('מחזיר מסך יחיד להצגה', () => {
    const id = allTabGuides()[0].id;
    markGuideSeen(id);
    expect(wasGuideSeen(id)).toBe(true);
    unmarkGuideSeen(id);
    expect(wasGuideSeen(id)).toBe(false);
    expect(shouldShowGuide(id)).toBe(true);
  });
});

describe('כשאין אחסון בדפדפן', () => {
  /** בחלון פרטי הפעולות זורקות שגיאה, ואסור שמסך ההגדרות ייפול. */
  function breakStorage() {
    vi.stubGlobal('localStorage', {
      get length() { throw new Error('אחסון חסום'); },
      key: () => { throw new Error('אחסון חסום'); },
      getItem: () => { throw new Error('אחסון חסום'); },
      setItem: () => { throw new Error('אחסון חסום'); },
      removeItem: () => { throw new Error('אחסון חסום'); },
    });
  }

  it('כל הפעולות אינן קורסות', () => {
    breakStorage();
    expect(() => countSeenGuides()).not.toThrow();
    expect(() => guidesByPage()).not.toThrow();
    expect(() => resetAllGuides()).not.toThrow();
    expect(() => resetPageGuides('text-editor')).not.toThrow();
    expect(() => setGuidesDisabledEverywhere(true)).not.toThrow();
    expect(() => isGuideDisabledEverywhere()).not.toThrow();
  });
});
