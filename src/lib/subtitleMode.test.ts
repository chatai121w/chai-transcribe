import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SUBTITLE_MODES, clearDefaultSubtitleMode, getDefaultSubtitleMode,
  setDefaultSubtitleMode, subtitleModeInfo,
} from './subtitleMode';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('סוגי הכתוביות', () => {
  it('יש שלוש אפשרויות', () => {
    expect(SUBTITLE_MODES).toHaveLength(3);
  });

  it('לכל אפשרות יש תווית, הסבר ומתי לבחור בה', () => {
    for (const m of SUBTITLE_MODES) {
      expect(m.label.trim(), m.id).not.toBe('');
      expect(m.body.trim(), m.id).not.toBe('');
      expect(m.when.trim(), m.id).not.toBe('');
    }
  });

  it('כל הטקסט בעברית', () => {
    // המשתמש אינו קורא אנגלית.
    const hebrew = /[א-ת]/;
    for (const m of SUBTITLE_MODES) {
      expect(hebrew.test(m.label), m.id).toBe(true);
      expect(hebrew.test(m.body), m.id).toBe(true);
      expect(hebrew.test(m.when), m.id).toBe(true);
    }
  });

  it('רק הצריבה דוחסת מחדש', () => {
    // דחיסה מחדש פוגעת באיכות, ולכן חייבת להיות מסומנת נכון.
    const reencoding = SUBTITLE_MODES.filter((m) => m.reencodes).map((m) => m.id);
    expect(reencoding).toEqual(['burned']);
  });

  it('רק הצריבה מוגבלת לשפה אחת', () => {
    // בצריבה הכתוביות נכנסות לתמונה, ולכן אי אפשר כמה שפות.
    const single = SUBTITLE_MODES.filter((m) => !m.multiLanguage).map((m) => m.id);
    expect(single).toEqual(['burned']);
  });

  it('מחזיר פרטים לפי מזהה', () => {
    expect(subtitleModeInfo('burned').label).toContain('צרוב');
    expect(subtitleModeInfo('default-track').reencodes).toBe(false);
  });

  it('מזהה שאינו קיים מחזיר את הראשון ולא קורס', () => {
    // עדיף ברירת מחדל סבירה על קריסה.
    expect(subtitleModeInfo('לא-קיים' as never)).toBe(SUBTITLE_MODES[0]);
  });
});

describe('ברירת המחדל', () => {
  it('בלי שמירה — מסלול שנדלק לבד', () => {
    // זאת הבחירה הבטוחה: נראה ברוב הנגנים, ובלי לפגוע באיכות.
    expect(getDefaultSubtitleMode()).toBe('default-track');
  });

  it('נשמרת ונקראת', () => {
    setDefaultSubtitleMode('burned');
    expect(getDefaultSubtitleMode()).toBe('burned');
  });

  it('אפשר לשנות שוב', () => {
    setDefaultSubtitleMode('burned');
    setDefaultSubtitleMode('track');
    expect(getDefaultSubtitleMode()).toBe('track');
  });

  it('איפוס מחזיר לברירת המחדל הרגילה', () => {
    setDefaultSubtitleMode('burned');
    clearDefaultSubtitleMode();
    expect(getDefaultSubtitleMode()).toBe('default-track');
  });

  it('ערך פגום בזיכרון אינו שובר כלום', () => {
    // מישהו ערך את האחסון ביד, או שנשמר ערך מגרסה ישנה.
    window.localStorage.setItem('subtitleMode.default', 'משהו-אחר');
    expect(getDefaultSubtitleMode()).toBe('default-track');
  });
});

describe('כשאין אחסון בדפדפן', () => {
  /**
   * בחלון פרטי הפעולות האלה זורקות שגיאה. בחירת ברירת מחדל היא
   * נוחות, ואסור שהיא תפיל את חלון החיבור.
   */
  function breakStorage() {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('אחסון חסום'); },
      setItem: () => { throw new Error('אחסון חסום'); },
      removeItem: () => { throw new Error('אחסון חסום'); },
    });
  }

  it('הקריאה מחזירה ברירת מחדל ולא קורסת', () => {
    breakStorage();
    expect(() => getDefaultSubtitleMode()).not.toThrow();
    expect(getDefaultSubtitleMode()).toBe('default-track');
  });

  it('הכתיבה אינה קורסת', () => {
    breakStorage();
    expect(() => setDefaultSubtitleMode('burned')).not.toThrow();
    expect(() => clearDefaultSubtitleMode()).not.toThrow();
  });
});
