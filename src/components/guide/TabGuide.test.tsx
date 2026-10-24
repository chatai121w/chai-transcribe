import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TabGuide from './TabGuide';
import {
  getTabGuide, isGuideDisabledEverywhere, wasGuideSeen,
} from '@/lib/tabGuides';

const GUIDE = getTabGuide('voice-studio/read')!;

beforeEach(() => {
  window.localStorage.clear();
  // jsdom אינו מממש את זה, והרכיב קורא לו כדי לכבד תנועה מופחתת.
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('מסך ההדרכה', () => {
  it('מציג את הכותרת ואת כל האפשרויות', () => {
    render(<TabGuide guide={GUIDE} open onClose={() => {}} />);
    expect(screen.getByText(GUIDE.title)).toBeTruthy();
    expect(screen.getByText(GUIDE.subtitle)).toBeTruthy();
    for (const item of GUIDE.items) {
      expect(screen.getByText(item.title), item.title).toBeTruthy();
    }
  });

  it('אינו מציג כלום כשהוא סגור', () => {
    render(<TabGuide guide={GUIDE} open={false} onClose={() => {}} />);
    expect(screen.queryByText(GUIDE.title)).toBeNull();
  });

  it('מציג את משפט הפתיחה כשיש', () => {
    render(<TabGuide guide={GUIDE} open onClose={() => {}} />);
    if (GUIDE.startHere) {
      expect(screen.getByText(/מאיפה מתחילים/)).toBeTruthy();
    }
  });

  describe('דילוג מול אל-תציג-שוב', () => {
    /**
     * זאת ההבחנה המרכזית. דילוג סוגר להפעם ומשאיר את ההדרכה לפעם
     * הבאה; "אל תציג שוב" מבטל לתמיד. אם שניהם היו עושים אותו דבר,
     * מי שסוגר במהירות היה מאבד את ההדרכה בלי כוונה.
     */

    it('דילוג סוגר אבל אינו מסמן כנראה', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<TabGuide guide={GUIDE} open onClose={onClose} />);

      await user.click(screen.getByRole('button', { name: 'דלג' }));

      expect(onClose).toHaveBeenCalledOnce();
      expect(wasGuideSeen(GUIDE.id)).toBe(false);
    });

    it('"הבנתי" מסמן כנראה', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<TabGuide guide={GUIDE} open onClose={onClose} />);

      await user.click(screen.getByRole('button', { name: /הבנתי/ }));

      expect(onClose).toHaveBeenCalledOnce();
      expect(wasGuideSeen(GUIDE.id)).toBe(true);
    });

    it('סימון "אל תציג שוב" מסמן גם בדילוג', async () => {
      const user = userEvent.setup();
      render(<TabGuide guide={GUIDE} open onClose={() => {}} />);

      await user.click(screen.getByLabelText('אל תציג את ההדרכה הזאת שוב'));
      await user.click(screen.getByRole('button', { name: 'דלג' }));

      expect(wasGuideSeen(GUIDE.id)).toBe(true);
    });

    it('"בכל הטאבים" מבטל את כולן', async () => {
      const user = userEvent.setup();
      render(<TabGuide guide={GUIDE} open onClose={() => {}} />);

      await user.click(screen.getByLabelText('בטל את כל ההדרכות'));
      await user.click(screen.getByRole('button', { name: 'דלג' }));

      expect(isGuideDisabledEverywhere()).toBe(true);
    });

    it('בלי סימון, הביטול הגורף אינו מופעל', async () => {
      const user = userEvent.setup();
      render(<TabGuide guide={GUIDE} open onClose={() => {}} />);
      await user.click(screen.getByRole('button', { name: /הבנתי/ }));
      expect(isGuideDisabledEverywhere()).toBe(false);
    });
  });

  describe('דרכי יציאה', () => {
    it('מקש הבריחה סוגר', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<TabGuide guide={GUIDE} open onClose={onClose} />);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('מקש הבריחה אינו מסמן כנראה', async () => {
      const user = userEvent.setup();
      render(<TabGuide guide={GUIDE} open onClose={() => {}} />);
      await user.keyboard('{Escape}');
      await waitFor(() => expect(wasGuideSeen(GUIDE.id)).toBe(false));
    });

    it('כפתור הסגירה סוגר', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<TabGuide guide={GUIDE} open onClose={onClose} />);
      await user.click(screen.getByLabelText('סגור'));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('לחיצה על הרקע סוגרת', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const { container } = render(<TabGuide guide={GUIDE} open onClose={onClose} />);
      const backdrop = container.querySelector('[aria-hidden]');
      expect(backdrop).toBeTruthy();
      await user.click(backdrop as Element);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('נגישות', () => {
    it('מוכרז כחלון דו-שיח עם כותרת', () => {
      render(<TabGuide guide={GUIDE} open onClose={() => {}} />);
      const dialog = screen.getByRole('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-labelledby')).toBe('guide-title');
    });

    it('כתוב מימין לשמאל', () => {
      render(<TabGuide guide={GUIDE} open onClose={() => {}} />);
      expect(screen.getByRole('dialog').getAttribute('dir')).toBe('rtl');
    });

    it('מחזיר את הגלילה לדף אחרי סגירה', () => {
      const { unmount } = render(<TabGuide guide={GUIDE} open onClose={() => {}} />);
      expect(document.body.style.overflow).toBe('hidden');
      unmount();
      expect(document.body.style.overflow).not.toBe('hidden');
    });
  });

  describe('תנועה מופחתת', () => {
    /**
     * למשתמש שהגדיר במערכת שאינו רוצה אנימציות, תנועה גורמת
     * אי-נוחות ממשית. במצב הזה הכל חייב להופיע מיד.
     */
    it('בלי אנימציות כשהמשתמש ביקש', () => {
      vi.stubGlobal('matchMedia', (q: string) => ({
        matches: q.includes('reduced-motion'), media: q, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }));
      const { container } = render(<TabGuide guide={GUIDE} open onClose={() => {}} />);
      const animated = [...container.querySelectorAll<HTMLElement>('*')]
        .filter((el) => el.style.animation);
      expect(animated.length).toBe(0);
    });

    it('עם אנימציות כברירת מחדל', () => {
      const { container } = render(<TabGuide guide={GUIDE} open onClose={() => {}} />);
      const animated = [...container.querySelectorAll<HTMLElement>('*')]
        .filter((el) => el.style.animation);
      expect(animated.length).toBeGreaterThan(0);
    });

    it('הכרטיסים נכנסים בזה אחר זה ולא יחד', () => {
      // ההשהיה אינה קישוט: היא מובילה את העין לפי הסדר.
      const { container } = render(<TabGuide guide={GUIDE} open onClose={() => {}} />);
      const delays = [...container.querySelectorAll<HTMLElement>('*')]
        .map((el) => el.style.animationDelay)
        .filter((d) => d && d !== '0ms' && d !== '0s');
      expect(delays.length).toBeGreaterThan(1);
      expect(new Set(delays).size).toBeGreaterThan(1);
    });
  });
});
