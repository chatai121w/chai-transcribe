import { readFileSync } from 'node:fs';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncMirrorLayout } from './SyncMirrorLayout';

vi.mock('./ExportButton', () => ({ ExportButton: () => null }));

/**
 * נעילת צד, ושמירות.
 *
 * הנעילה מבטיחה למשתמש דבר אחד: "שחרר את הנעילה כדי לערוך". הבטחה
 * כזאת שווה בדיוק כמו המסלול החלש ביותר שעוקף אותה — ונמצאו שניים
 * שעקפו, בלי הודעה ובלי שום סימן.
 *
 * הבדיקות כאן נכתבו אחרי שהתגלו, והן קוראות את הקוד עצמו ולא רק
 * מריצות אותו: מסלול שעוקף נראה בדיוק כמו מסלול תקין בזמן ריצה,
 * וההבדל ביניהם הוא שורה אחת בקוד.
 */

const SRC = readFileSync('src/components/SyncMirrorLayout.tsx', 'utf8');
const TEXT = 'מסכת בכורות עוסקת בדיני בכורות';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); });

describe('מי רשאי לשנות את הטקסט', () => {
  it('העריכה בצד עוברת דרך שומר הנעילה', () => {
    expect(SRC).toContain("onChange={(v) => handleTextChangeFromPane('left', v)}");
  });

  it('סרגל הסימון עובר דרך שומר הנעילה', () => {
    // הוא שינה את הטקסט בשלושה מקומות וקיבל את הפונקציה הגולמית,
    // ולכן סימון שינה טקסט גם בצד נעול.
    const i = SRC.indexOf('<TextMarkingOverlay');
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, i + 400);
    expect(block).toContain('handleTextChangeFromPane');
    expect(block).not.toMatch(/onTextChange=\{onTextChange\}/);
  });

  it('השומר באמת חוסם את הצד הנעול', () => {
    const i = SRC.indexOf('const handleTextChangeFromPane');
    const block = SRC.slice(i, i + 400);
    expect(block).toContain('lockedPane === side');
    expect(block).toContain('return');
  });

  it('הנעילה נשמרת בין טעינות', () => {
    expect(SRC).toContain("localStorage.setItem('sync_mirror_locked_pane'");
    expect(SRC).toContain("localStorage.getItem('sync_mirror_locked_pane')");
  });
});

describe('עקיפות מוכרות שנשארו בכוונה', () => {
  /**
   * שלושת המסלולים האלה כן משנים טקסט בלי לעבור בשומר, והם
   * מסומנים כאן במפורש: עריכה מלאה, והחזרה לגרסת בסיס. שניהם
   * פעולות מפורשות של המשתמש מתוך תפריט, ולא עריכה בצד.
   *
   * הבדיקה אינה אוסרת עליהם — היא רק מוודאת שמספרם לא גדל בלי
   * שאף אחד שם לב.
   */
  it('מספר המסלולים הישירים אינו גדל', () => {
    const direct = (SRC.match(/[^a-zA-Z]onTextChange\(/g) || []).length;
    expect(direct).toBeLessThanOrEqual(5);
  });
});

describe('שמירות', () => {
  it('שמירה מתוך העורך עוברת באותה עטיפה כמו הכפתור', () => {
    // בלעדיה שמירה מהעורך הייתה שקטה: בלי אישור ובלי הודעת שגיאה.
    expect(SRC).toContain('onSaveReplaceOriginal={onSaveReplace ? handleSaveLocalAndCloud : undefined}');
  });

  it('העטיפה מודיעה גם על הצלחה וגם על כישלון', () => {
    const i = SRC.indexOf('const handleSaveLocalAndCloud');
    const block = SRC.slice(i, i + 500);
    expect(block).toContain('נשמר');
    expect(block).toContain('destructive');
  });

  it('אין שתי עטיפות שמירה שונות', () => {
    // שתי עטיפות פירושן שתי התנהגויות לאותה פעולה, וזה בדיוק
    // מה שהיה כאן.
    const wrappers = (SRC.match(/const handleSave\w*LocalAndCloud/g) || []).length;
    expect(wrappers).toBe(1);
  });
});

describe('המסך עדיין עובד', () => {
  it('נטען ומציג את הטקסט', async () => {
    const view = render(
      <SyncMirrorLayout
        wordTimings={[]}
        currentTime={0}
        text={TEXT}
        syncEnabled={false}
        onTextChange={vi.fn()}
        onWordReplace={vi.fn()}
        onWordClick={vi.fn()}
      />,
    );
    await waitFor(() => expect(view.container.textContent).toContain('בכורות'));
  });

});
