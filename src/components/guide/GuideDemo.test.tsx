import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuideDemo, DEMO_LABELS, DEMO_STYLES } from './GuideDemo';

/**
 * ההמחשות המונפשות בהדרכה.
 *
 * הבדיקות כאן אינן על "האם זה נראה יפה" — זה דבר שרק העין קובעת.
 * הן על ארבע הבטחות שאפשר לשבור בלי לשים לב:
 *
 *   תנועה מופחתת     מי שביקש במערכת ההפעלה פחות תנועה חייב לקבל
 *                    תמונה קפואה. שבירה כאן אינה נראית לאיש שאינו
 *                    רגיש לתנועה — ופוגעת בדיוק במי שכן.
 *
 *   תיאור לקורא מסך  אנימציה בלי תיאור היא ריבוע ריק למי שאינו
 *                    רואה אותה.
 *
 *   רצה רק כשרואים   אנימציה אינסופית בכרטיס שגולל מחוץ למסך
 *                    צורכת חישוב בלי שאיש מרוויח.
 *
 *   שני הסגנונות     אם שניהם מצוירים אותו דבר, הבחירה היא כפתור
 *                    שלא עושה כלום.
 */

const mql = (matches: boolean) => ({
  matches,
  media: '',
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

/** הצופה אינו קיים בסביבת הבדיקה — בלעדיו הרכיב נופל. */
class FakeObserver {
  constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql(false)));
  vi.stubGlobal('IntersectionObserver', FakeObserver as unknown as typeof IntersectionObserver);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('תנועה מופחתת', () => {
  it('מי שביקש פחות תנועה מקבל תמונה קפואה', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql(true)));
    const { container } = render(<GuideDemo kind="drag" />);
    expect(container.querySelector('.gd-still')).toBeTruthy();
  });

  it('מי שלא ביקש מקבל תנועה', () => {
    const { container } = render(<GuideDemo kind="drag" />);
    expect(container.querySelector('.gd-still')).toBeFalsy();
  });

  it('גם במצב קפוא הצורות עדיין מצוירות', () => {
    // קפוא פירושו תמונה סופית, לא ריבוע ריק.
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql(true)));
    const { container } = render(<GuideDemo kind="record" />);
    expect(container.querySelectorAll('.gd-box').length).toBeGreaterThan(0);
  });
});

describe('נגישות', () => {
  it('לכל המחשה יש תיאור', () => {
    for (const kind of Object.keys(DEMO_LABELS) as (keyof typeof DEMO_LABELS)[]) {
      const { container, unmount } = render(<GuideDemo kind={kind} />);
      const el = container.querySelector('[role="img"]');
      expect(el?.getAttribute('aria-label'), kind).toBeTruthy();
      unmount();
    }
  });

  it('אפשר להחליף את התיאור', () => {
    const { container } = render(<GuideDemo kind="play" label="דוגמה משלי" />);
    expect(container.querySelector('[aria-label="דוגמה משלי"]')).toBeTruthy();
  });
});

describe('שני הסגנונות', () => {
  it('מצוירים אחרת זה מזה', () => {
    // אם שניהם זהים, הבחירה היא כפתור שלא עושה כלום.
    const a = render(<GuideDemo kind="drag" style="quiet" />).container.innerHTML;
    cleanup();
    const b = render(<GuideDemo kind="drag" style="lively" />).container.innerHTML;
    expect(a).not.toEqual(b);
  });

  it('שניהם מופיעים ברשימת הבחירה עם הסבר', () => {
    expect(DEMO_STYLES).toHaveLength(2);
    for (const s of DEMO_STYLES) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.note.length).toBeGreaterThan(0);
    }
  });
});

describe('כל סוגי ההמחשה', () => {
  it('כולם נטענים בלי לקרוס ומציירים משהו', () => {
    for (const kind of Object.keys(DEMO_LABELS) as (keyof typeof DEMO_LABELS)[]) {
      const { container, unmount } = render(<GuideDemo kind={kind} />);
      expect(container.querySelector(`.gd-${kind}`), kind).toBeTruthy();
      expect(container.querySelectorAll('.gd-box, .gd-ptr').length, kind)
        .toBeGreaterThan(0);
      unmount();
    }
  });

  it('כל אחד מצייר צורות אחרות', () => {
    // סוג שמצייר בדיוק כמו אחר הוא סוג מיותר.
    const seen = new Set<string>();
    for (const kind of Object.keys(DEMO_LABELS) as (keyof typeof DEMO_LABELS)[]) {
      const { container, unmount } = render(<GuideDemo kind={kind} />);
      const shape = [...container.querySelectorAll('.gd-box, .gd-ptr')]
        .map((e) => e.className).join('|');
      expect(seen.has(shape), kind).toBe(false);
      seen.add(shape);
      unmount();
    }
  });
});

describe('כשאין צופה בסביבה', () => {
  it('מצייר בכל זאת ואינו נשאר קפוא לנצח', () => {
    // בסביבות ישנות אין צופה. בלי הנפילה-לאחור ההמחשה לא הייתה
    // זזה לעולם, בלי שום שגיאה שתסגיר את זה.
    vi.stubGlobal('IntersectionObserver', undefined);
    const { container } = render(<GuideDemo kind="click" />);
    expect(container.querySelector('.gd-still')).toBeFalsy();
  });
});
