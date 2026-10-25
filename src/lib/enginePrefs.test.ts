import { describe, expect, it } from 'vitest';
import {
  ENGINE_ORDER, ENGINE_PREFS_DEFAULT, type EnginePrefs,
  isEngineVisible, moveEngine, normalisePrefs, orderedEngines,
  toggleEngine, visibleEngines,
} from './enginePrefs';

/**
 * בחירת מנועי התמלול שמוצגים, והסדר שלהם.
 *
 * רוב הבדיקות כאן אינן על "האם זה עובד" אלא על שלוש הגנות. כל
 * אחת מהן מונעת מצב שבו המסך נראה תקין אך אי אפשר לצאת ממנו:
 *
 *   מנוע חדש לא נעלם   מי שקבע סדר פעם אחת לא היה רואה לעולם
 *                      מנוע שיתווסף לתוכנה אחר כך.
 *
 *   הנבחר תמיד מוצג    מי שמסתיר את המנוע שהוא עובד איתו היה
 *                      רואה מסך שבו אף מנוע אינו נבחר, בלי רמז.
 *
 *   אי אפשר לרוקן      מסך בלי שום מנוע הוא מסך שבור, ואין ממנו
 *                      דרך חזרה.
 */

const prefs = (p: Partial<EnginePrefs> = {}): EnginePrefs => ({
  ...ENGINE_PREFS_DEFAULT, ...p,
});

describe('סדר התצוגה', () => {
  it('בלי העדפה — הסדר המקורי', () => {
    expect(orderedEngines(prefs())).toEqual(ENGINE_ORDER);
  });

  it('מנוע שלא ברשימת הסדר נוסף בסוף ואינו נעלם', () => {
    // ההגנה החשובה ביותר כאן: מנוע שיתווסף לתוכנה בעתיד חייב
    // להופיע גם אצל מי שכבר קבע סדר.
    const r = orderedEngines(prefs({ order: ['gemini', 'groq'] }));
    expect(r.slice(0, 2)).toEqual(['gemini', 'groq']);
    expect(r).toHaveLength(ENGINE_ORDER.length);
    for (const e of ENGINE_ORDER) expect(r).toContain(e);
  });

  it('שם שאינו מנוג מוכר מוסר', () => {
    const r = normalisePrefs({ order: ['groq', 'לא-קיים'], hidden: ['xyz'] });
    expect(r.order).toEqual(['groq']);
    expect(r.hidden).toEqual([]);
  });

  it('כפילות בסדר מוסרת', () => {
    // בלי זה גרירה חוזרת הייתה מציירת מנוע פעמיים.
    expect(normalisePrefs({ order: ['groq', 'groq', 'openai'] }).order)
      .toEqual(['groq', 'openai']);
  });
});

describe('הצגה והסתרה', () => {
  it('מנוע מוסתר אינו מוצג', () => {
    expect(isEngineVisible('groq', prefs({ hidden: ['groq'] }))).toBe(false);
  });

  it('המנוע הנבחר מוצג גם כשהוא מסומן כמוסתר', () => {
    // בלי זה המשתמש מסתיר את מה שהוא עובד איתו, והמסך מראה
    // שאף מנוע אינו נבחר.
    expect(isEngineVisible('groq', prefs({ hidden: ['groq'] }), 'groq')).toBe(true);
  });

  it('ההחלפה עובדת לשני הכיוונים', () => {
    const a = toggleEngine(prefs(), 'groq');
    expect(a.hidden).toContain('groq');
    expect(toggleEngine(a, 'groq').hidden).not.toContain('groq');
  });

  it('אי אפשר להסתיר את האחרון שנשאר', () => {
    // מסך ריק הוא מסך שאין ממנו דרך חזרה.
    const all = ENGINE_ORDER.slice(0, -1);
    const last = ENGINE_ORDER[ENGINE_ORDER.length - 1];
    const p = prefs({ hidden: all });
    expect(visibleEngines(p)).toEqual([last]);
    expect(toggleEngine(p, last)).toEqual(p);
    expect(visibleEngines(toggleEngine(p, last))).toEqual([last]);
  });

  it('הרשימה המוצגת מכבדת גם סדר וגם הסתרה', () => {
    const p = prefs({ order: ['gemini', 'groq', 'openai'], hidden: ['groq'] });
    const v = visibleEngines(p);
    expect(v[0]).toBe('gemini');
    expect(v).not.toContain('groq');
  });
});

describe('גרירה', () => {
  it('מעביר מנוע למקום חדש', () => {
    const p = moveEngine(prefs(), 'gemini', 0);
    expect(orderedEngines(p)[0]).toBe('gemini');
  });

  it('העברה למקום הנוכחי אינה משנה דבר', () => {
    const p = prefs();
    expect(moveEngine(p, ENGINE_ORDER[0], 0)).toBe(p);
  });

  it('מקום מחוץ לטווח נצמד לקצה ולא מאבד מנוע', () => {
    const p = moveEngine(prefs(), 'groq', 999);
    const r = orderedEngines(p);
    expect(r[r.length - 1]).toBe('groq');
    expect(r).toHaveLength(ENGINE_ORDER.length);
  });

  it('מנוע שאינו מוכר אינו משנה דבר', () => {
    const p = prefs();
    expect(moveEngine(p, 'לא-קיים' as never, 0)).toBe(p);
  });

  it('אחרי גרירה כל המנועים עדיין שם', () => {
    let p = prefs();
    p = moveEngine(p, 'local', 0);
    p = moveEngine(p, 'groq', 4);
    p = moveEngine(p, 'gemini', 2);
    const r = orderedEngines(p);
    expect(new Set(r).size).toBe(ENGINE_ORDER.length);
  });
});

describe('ערך פגום אינו מפיל', () => {
  it('ריק, null, או מבנה אחר', () => {
    for (const bad of [null, undefined, 0, 'x', [], { order: 'x' }]) {
      expect(() => normalisePrefs(bad)).not.toThrow();
      expect(normalisePrefs(bad)).toEqual({ order: [], hidden: [] });
    }
  });
});
