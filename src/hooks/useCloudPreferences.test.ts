import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * שמירת ההעדפות לענן.
 *
 * הבדיקות כאן קוראות את הקוד ולא מריצות אותו, בכוונה: הבעיה
 * שתוקנה כאן אינה נראית בזמן ריצה רגיל. פונקציית עדכון מצב
 * שעושה תופעת לוואי עובדת "נכון" ברוב המקרים, ונשברת רק כשריאקט
 * מחליט להריץ אותה פעמיים — ואז נשמר פעמיים בלי שאף אחד יודע.
 *
 * מה שהיה: שלוש הפונקציות ששומרות העדפות קראו לשמירה לענן מתוך
 * פונקציית העדכון עצמה. זה גרם לשני דברים —
 *
 *   שמירה כפולה לענן על שינוי יחיד.
 *   אזהרה בדפדפן על עדכון רכיב בזמן רינדור של רכיב אחר, כי
 *   השמירה כותבת ליומן וחלון הפקודות מאזין ליומן.
 *
 * מה שיש: הפונקציה מניחה את הערך בתור, והריקון קורה אחרי
 * שהרינדור הסתיים.
 */

const SRC = readFileSync('src/hooks/useCloudPreferences.ts', 'utf8');

/** גוף כל קריאה ל-setPreferences עם פונקציית עדכון. */
function updaterBodies(): string[] {
  const out: string[] = [];
  const re = /setPreferences\(prev => \{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(SRC))) {
    // סופרים סוגריים עד לסגירה המתאימה
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < SRC.length; i++) {
      if (SRC[i] === '{') depth++;
      else if (SRC[i] === '}') { depth--; if (depth === 0) break; }
    }
    out.push(SRC.slice(start, i + 1));
  }
  return out;
}

describe('פונקציית עדכון המצב נקייה', () => {
  it('נמצאו פונקציות עדכון לבדוק', () => {
    expect(updaterBodies().length).toBeGreaterThanOrEqual(3);
  });

  it('אף אחת מהן אינה שומרת לענן', () => {
    // זאת הבעיה עצמה: שמירה בתוך פונקציית עדכון רצה פעמיים.
    for (const body of updaterBodies()) {
      expect(body.includes('saveToCloud('), body.slice(0, 60)).toBe(false);
    }
  });

  it('אף אחת מהן אינה כותבת ישירות לאחסון המקומי', () => {
    // אותה בעיה בדיוק, רק בלי ענן.
    for (const body of updaterBodies()) {
      expect(body.includes('localStorage.setItem'), body.slice(0, 60)).toBe(false);
    }
  });

  it('כולן מניחות בתור במקום לשמור', () => {
    const withQueue = updaterBodies().filter((b) => b.includes('queueSave('));
    expect(withQueue.length).toBeGreaterThanOrEqual(3);
  });
});

describe('הריקון קורה אחרי הרינדור', () => {
  it('יש תור', () => {
    expect(SRC).toContain('pendingSaveRef');
  });

  it('הריקון יושב בתוך useEffect', () => {
    const i = SRC.indexOf('pendingSaveRef.current;');
    expect(i).toBeGreaterThan(-1);
    const before = SRC.slice(Math.max(0, i - 200), i);
    expect(before).toContain('useEffect');
  });

  it('התור מתרוקן אחרי שנקרא, כדי שלא יישמר שוב', () => {
    const i = SRC.indexOf('const pending = pendingSaveRef.current;');
    const block = SRC.slice(i, i + 300);
    expect(block).toContain('pendingSaveRef.current = null;');
  });

  it('השמירה האמיתית נקראת רק מהריקון', () => {
    // קריאה אחת בלבד לכל הקובץ — זו שבתוך הריקון.
    const calls = (SRC.match(/[^a-zA-Z]saveToCloud\(/g) || []).length;
    expect(calls).toBe(1);
  });
});

describe('שלוש דרכי העדכון קיימות', () => {
  it('כולן עדיין מיוצאות', () => {
    for (const name of ['updatePreference', 'updatePreferences', 'patchTabSettings']) {
      expect(SRC).toContain(`const ${name} = useCallback(`);
    }
  });

  it('כולן תלויות בתור ולא בשמירה', () => {
    // תלות ישנה פירושה פונקציה שנבנית מחדש בלי סיבה.
    const deps = SRC.match(/\}, \[(queueSave|saveToCloud)\]\);/g) || [];
    expect(deps.length).toBeGreaterThanOrEqual(3);
    expect(deps.every((d) => d.includes('queueSave'))).toBe(true);
  });
});
