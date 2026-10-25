import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ENGINE_PANEL_LAYOUT, ENGINE_PANEL_LAYOUTS, ENGINE_PANEL_LAYOUT_KEY,
  enginePanelClasses, isEnginePanelLayout,
} from './enginePanelLayout';

describe('פריסות פאנל המנוע', () => {
  it('יש ארבע פריסות', () => {
    expect(ENGINE_PANEL_LAYOUTS).toHaveLength(4);
  });

  it('לכל פריסה שם והסבר בעברית', () => {
    // המשתמש אינו קורא אנגלית, והבורר מוצג לו ישירות.
    const hebrew = /[א-ת]/;
    for (const l of ENGINE_PANEL_LAYOUTS) {
      expect(hebrew.test(l.label), l.id).toBe(true);
      expect(hebrew.test(l.hint), l.id).toBe(true);
    }
  });

  it('אין מזהה כפול', () => {
    const ids = ENGINE_PANEL_LAYOUTS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ברירת המחדל היא אחת מהפריסות', () => {
    expect(isEnginePanelLayout(DEFAULT_ENGINE_PANEL_LAYOUT)).toBe(true);
  });

  it('ברירת המחדל אינה הפריסה הרחבה', () => {
    // הפריסה הרחבה היא בדיוק מה שנראה מפוזר ושביקשו לתקן.
    expect(DEFAULT_ENGINE_PANEL_LAYOUT).not.toBe('wide');
  });

  it('מזהה שאינו קיים נדחה', () => {
    expect(isEnginePanelLayout('לא-קיים')).toBe(false);
    expect(isEnginePanelLayout(undefined)).toBe(false);
    expect(isEnginePanelLayout(null)).toBe(false);
    expect(isEnginePanelLayout(7)).toBe(false);
  });
});

describe('מחלקות העיצוב', () => {
  it('כל פריסה מחזירה את כל השדות, ואף אחד אינו ריק', () => {
    // שדה ריק פירושו רכיב בלי עיצוב כלל, וזה נראה שבור.
    const fields = ['wrap', 'card', 'group', 'button', 'hint', 'label'] as const;
    for (const l of ENGINE_PANEL_LAYOUTS) {
      const c = enginePanelClasses(l.id);
      for (const f of fields) {
        expect(typeof c[f], `${l.id}.${f}`).toBe('string');
        expect(c[f].trim().length, `${l.id}.${f}`).toBeGreaterThan(0);
      }
    }
  });

  it('רק הפריסה המינימלית מסתירה את ההסברים', () => {
    const hidden = ENGINE_PANEL_LAYOUTS
      .filter((l) => enginePanelClasses(l.id).hint.includes('hidden'))
      .map((l) => l.id);
    expect(hidden).toEqual(['mini']);
  });

  it('הכפתור הרחב הוא היחיד שנמתח', () => {
    // flex-1 הוא מה שגרם לכפתור לתפוס את כל השורה.
    const stretched = ENGINE_PANEL_LAYOUTS
      .filter((l) => enginePanelClasses(l.id).button.includes('flex-1'))
      .map((l) => l.id);
    expect(stretched).toEqual(['wide']);
  });

  it('כל פריסה מגדירה גובה לכפתור', () => {
    for (const l of ENGINE_PANEL_LAYOUTS) {
      expect(enginePanelClasses(l.id).button, l.id).toMatch(/\bh-\d/);
    }
  });

  it('הפריסה המינימלית דחוסה יותר מהרחבה', () => {
    const wide = enginePanelClasses('wide');
    const mini = enginePanelClasses('mini');
    const height = (c: string) => Number((c.match(/\bh-(\d+)/) || [])[1]);
    expect(height(mini.button)).toBeLessThan(height(wide.button));
  });

  it('פריסה שאינה מוכרת נופלת לברירת מחדל ולא קורסת', () => {
    const c = enginePanelClasses('לא-קיים' as never);
    expect(c.card.trim().length).toBeGreaterThan(0);
  });
});

describe('מפתח השמירה', () => {
  it('קבוע ולא ריק', () => {
    // המפתח הזה נשמר בענן. שינוי שלו מאבד את הבחירה של כל המשתמשים.
    expect(ENGINE_PANEL_LAYOUT_KEY).toBe('engine_panel_layout');
  });
});
