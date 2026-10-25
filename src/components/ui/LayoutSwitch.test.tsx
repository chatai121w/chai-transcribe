import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { LayoutSwitch } from './LayoutSwitch';

const OPTIONS = [
  { id: 'a', label: 'רחב', hint: 'כל אפשרות בשורה' },
  { id: 'b', label: 'צמוד', hint: 'כפתורים ברוחב הטקסט' },
  { id: 'c', label: 'שורה', hint: 'הכל בשורה אחת' },
] as const;

function setup(value: 'a' | 'b' | 'c' = 'a', onChange = vi.fn()) {
  render(
    <LayoutSwitch
      label="בדיקה"
      value={value}
      onChange={onChange}
      options={OPTIONS as unknown as Array<{ id: string; label: string; hint: string }>}
    />,
  );
  return onChange;
}

describe('בורר הפריסה', () => {
  it('מציג את כל האפשרויות', () => {
    setup();
    for (const o of OPTIONS) expect(screen.getByText(o.label)).toBeTruthy();
  });

  it('מסמן את הנבחרת בלבד', () => {
    setup('b');
    const tabs = screen.getAllByRole('tab');
    const on = tabs.filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(on).toHaveLength(1);
    expect(on[0].textContent).toContain('צמוד');
  });

  it('לחיצה מדווחת על הבחירה', () => {
    const onChange = setup('a');
    fireEvent.click(screen.getByText('שורה'));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('לחיצה על הנבחרת מדווחת גם היא', () => {
    // ההורה מחליט מה לעשות — לא הרכיב.
    const onChange = setup('a');
    fireEvent.click(screen.getByText('רחב'));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('מציג את ההסבר של הנבחרת', () => {
    setup('c');
    expect(screen.getByText('הכל בשורה אחת')).toBeTruthy();
  });

  it('יש שם לקוראי מסך', () => {
    setup();
    expect(screen.getByRole('tablist').getAttribute('aria-label')).toBe('בדיקה');
  });

  it('כשהוא מושבת אין דיווח', () => {
    const onChange = vi.fn();
    render(
      <LayoutSwitch
        label="מושבת" value="a" onChange={onChange} disabled
        options={OPTIONS as unknown as Array<{ id: string; label: string; hint: string }>}
      />,
    );
    fireEvent.click(screen.getByText('שורה'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('אחידות בין כל הבוררים בעמוד', () => {
  /**
   * הבדיקה הזאת היא הסיבה שהרכיב נוצר.
   *
   * קודם לכן היו שני בוררים שעושים את אותו דבר ונראים שונה
   * לגמרי. שני עותקים נפרדים לא נשארים זהים: מי שמשנה את אחד
   * מהם שוכח את השני. הבדיקה נכשלת אם מישהו יבנה עותק שלישי.
   */
  const FILES = [
    'src/components/TranscriptionEngine.tsx',
    'src/components/PronunciationStack.tsx',
  ];

  it('שני הפאנלים משתמשים ברכיב המשותף', () => {
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      expect(src.includes('<LayoutSwitch'), f).toBe(true);
    }
  });

  it('אף אחד מהם לא בנה בורר פריסה משלו', () => {
    // לשוניות תוכן הן שימוש אחר ולגיטימי — מה שאסור הוא בורר
    // פריסה נוסף, שיתחיל שוב להיראות שונה מהשאר.
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      const own = /role="tablist"[\s\S]{0,200}?aria-label="פריסת/.test(src);
      expect(own, f).toBe(false);
    }
  });

  it('לכל בורר שם ייחודי לקוראי מסך', () => {
    const names = FILES.map((f) => {
      const m = readFileSync(f, 'utf8').match(/label="(פריסת[^"]*)"/);
      return m ? m[1] : null;
    });
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });
});
