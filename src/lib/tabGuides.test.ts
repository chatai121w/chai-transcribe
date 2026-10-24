import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  allTabGuides, countSeenGuides, getTabGuide, isGuideDisabledEverywhere,
  markGuideSeen, resetAllGuides, setGuidesDisabledEverywhere, shouldShowGuide,
  wasGuideSeen,
} from './tabGuides';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('מרשם ההדרכות', () => {
  it('לכל הדרכה יש מזהה ייחודי', () => {
    const ids = allTabGuides().map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('לכל הדרכה יש כותרת, תיאור ולפחות אפשרות אחת', () => {
    for (const g of allTabGuides()) {
      expect(g.title.trim(), g.id).not.toBe('');
      expect(g.subtitle.trim(), g.id).not.toBe('');
      expect(g.items.length, g.id).toBeGreaterThan(0);
    }
  });

  it('לכל אפשרות יש אייקון, כותרת וגוף', () => {
    for (const g of allTabGuides()) {
      for (const item of g.items) {
        expect(item.icon, `${g.id} / ${item.title}`).toBeTruthy();
        expect(item.title.trim(), g.id).not.toBe('');
        expect(item.body.trim(), g.id).not.toBe('');
      }
    }
  });

  it('כל הטקסט בעברית', () => {
    // המשתמש אינו קורא אנגלית. טקסט באנגלית כאן הוא תקלה.
    const hebrew = /[א-ת]/;
    for (const g of allTabGuides()) {
      expect(hebrew.test(g.title), `כותרת ${g.id}`).toBe(true);
      expect(hebrew.test(g.subtitle), `תיאור ${g.id}`).toBe(true);
      for (const item of g.items) {
        expect(hebrew.test(item.title), `${g.id} / ${item.title}`).toBe(true);
        expect(hebrew.test(item.body), `${g.id} / ${item.title}`).toBe(true);
        if (item.tip) expect(hebrew.test(item.tip), `${g.id} / הערה`).toBe(true);
      }
    }
  });

  it('המזהים בנויים בתבנית של עמוד לוכסן טאב', () => {
    // החיבור בונה את המזהה כך, ומזהה בתבנית אחרת פשוט לא יימצא.
    for (const g of allTabGuides()) {
      expect(g.id, g.id).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
    }
  });

  it('מחזיר הדרכה לפי מזהה, ולא קורס על מזהה שאינו קיים', () => {
    expect(getTabGuide('voice-studio/read')).toBeTruthy();
    expect(getTabGuide('לא-קיים/בכלל')).toBeUndefined();
  });

  it('אין כפילויות בכותרות בתוך אותה הדרכה', () => {
    for (const g of allTabGuides()) {
      const titles = g.items.map((i) => i.title);
      expect(new Set(titles).size, g.id).toBe(titles.length);
    }
  });
});

describe('מתי ההדרכה מוצגת', () => {
  const ID = 'voice-studio/read';

  it('מוצגת בפעם הראשונה', () => {
    expect(shouldShowGuide(ID)).toBe(true);
  });

  it('אינה מוצגת אחרי שנראתה', () => {
    markGuideSeen(ID);
    expect(wasGuideSeen(ID)).toBe(true);
    expect(shouldShowGuide(ID)).toBe(false);
  });

  it('סימון טאב אחד אינו משפיע על טאב אחר', () => {
    // זאת הטעות הקלה: מפתח זיכרון משותף היה מבטל את כל ההדרכות
    // אחרי כניסה לטאב אחד.
    markGuideSeen(ID);
    expect(shouldShowGuide('voice-studio/compare')).toBe(true);
  });

  it('ביטול גורף מכבה את כולן', () => {
    setGuidesDisabledEverywhere(true);
    expect(isGuideDisabledEverywhere()).toBe(true);
    for (const g of allTabGuides()) {
      expect(shouldShowGuide(g.id), g.id).toBe(false);
    }
  });

  it('ביטול הביטול הגורף מחזיר את ההדרכות שלא נראו', () => {
    setGuidesDisabledEverywhere(true);
    setGuidesDisabledEverywhere(false);
    expect(shouldShowGuide(ID)).toBe(true);
  });

  it('טאב שאין לו הדרכה אינו מציג כלום', () => {
    expect(shouldShowGuide('אין-כזה/טאב')).toBe(false);
  });

  it('האיפוס מחזיר את כל ההדרכות', () => {
    allTabGuides().forEach((g) => markGuideSeen(g.id));
    setGuidesDisabledEverywhere(true);
    expect(countSeenGuides()).toBe(allTabGuides().length);

    resetAllGuides();

    expect(countSeenGuides()).toBe(0);
    expect(isGuideDisabledEverywhere()).toBe(false);
    expect(shouldShowGuide(ID)).toBe(true);
  });

  it('האיפוס אינו מוחק דברים אחרים מהזיכרון', () => {
    window.localStorage.setItem('משהו.אחר', 'חשוב');
    markGuideSeen(ID);
    resetAllGuides();
    expect(window.localStorage.getItem('משהו.אחר')).toBe('חשוב');
  });

  it('סופר כמה הדרכות נראו', () => {
    expect(countSeenGuides()).toBe(0);
    markGuideSeen(ID);
    markGuideSeen('voice-studio/batch');
    expect(countSeenGuides()).toBe(2);
  });
});

describe('כשאין אחסון בדפדפן', () => {
  /**
   * בחלון פרטי ובדפדפן שחוסם אחסון, הפעולות האלה זורקות שגיאה.
   * הדרכה היא נוחות, ואסור שהיא תפיל את המסך.
   */
  function breakStorage() {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('אחסון חסום'); },
      setItem: () => { throw new Error('אחסון חסום'); },
      removeItem: () => { throw new Error('אחסון חסום'); },
      key: () => { throw new Error('אחסון חסום'); },
      clear: () => { throw new Error('אחסון חסום'); },
      get length(): number { throw new Error('אחסון חסום'); },
    });
  }

  it('הקריאה אינה קורסת', () => {
    breakStorage();
    expect(() => wasGuideSeen('voice-studio/read')).not.toThrow();
    expect(wasGuideSeen('voice-studio/read')).toBe(false);
  });

  it('הכתיבה אינה קורסת', () => {
    breakStorage();
    expect(() => markGuideSeen('voice-studio/read')).not.toThrow();
    expect(() => setGuidesDisabledEverywhere(true)).not.toThrow();
  });

  it('האיפוס אינו קורס', () => {
    breakStorage();
    expect(() => resetAllGuides()).not.toThrow();
  });

  it('ההדרכה פשוט תוצג שוב — מטריד, אבל לא שבור', () => {
    breakStorage();
    markGuideSeen('voice-studio/read');
    expect(shouldShowGuide('voice-studio/read')).toBe(true);
  });
});

describe('התאמה לטאבים האמיתיים במערכת', () => {
  /**
   * זאת הבדיקה החשובה ביותר כאן.
   *
   * מזהה הדרכה נבנה מהקידומת של העמוד ומערך הטאב. מזהה שאינו תואם
   * לערך אמיתי פשוט לא יימצא — ההדרכה לא תוצג, ושום דבר לא ייפול.
   * כלומר זה כשל שקט לגמרי, ואי אפשר לראות אותו בלי לבדוק כל טאב
   * ביד.
   *
   * הרשימה כאן נלקחה מהקוד בפועל. כשמוסיפים טאב חדש לעמוד, צריך
   * להוסיף אותו גם כאן — והבדיקה תזכיר.
   */
  const REAL_TABS: Record<string, string[]> = {
    'voice-studio': ['enhance', 'compare', 'batch', 'read', 'flows'],
    'index': ['transcribe', 'edit', 'youtube'],
    'text-editor': [
      'player', 'loshon', 'speakers', 'templates', 'ai', 'pipeline',
      'prompts', 'ollama', 'vocab', 'summary', 'analytics', 'compare', 'history',
    ],
    'personal-learning': [
      'vocabulary', 'corrections', 'definitive', 'profiles', 'loshon-kodesh',
    ],
    'lashon-kodesh': ['transcribe', 'settings', 'training', 'benchmark'],
    'youtube': ['new', 'manager'],
    'video-to-mp3': ['convert', 'extract', 'cut'],
    'translation': ['library', 'file', 'paste'],
    'setup': ['scan', 'install', 'model', 'verify'],
  };

  it('כל הדרכה מצביעה על טאב שקיים באמת', () => {
    for (const g of allTabGuides()) {
      const [page, tab] = g.id.split('/');
      const known = REAL_TABS[page];
      expect(known, `העמוד ${page} אינו ברשימה`).toBeTruthy();
      expect(known, `${g.id}: הטאב ${tab} אינו קיים בעמוד`).toContain(tab);
    }
  });

  it('הקידומות שבשימוש מוכרות', () => {
    const used = new Set(allTabGuides().map((g) => g.id.split('/')[0]));
    for (const prefix of used) {
      expect(Object.keys(REAL_TABS), prefix).toContain(prefix);
    }
  });
});
