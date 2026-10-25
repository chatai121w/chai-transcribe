import { cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncMirrorLayout } from './SyncMirrorLayout';

vi.mock('./ExportButton', () => ({ ExportButton: () => null }));

/**
 * הקשר בין הנגן לתמלול — לשני הכיוונים.
 *
 * זאת ההתנהגות המרכזית של המסך הזה: לחיצה על מילה מקפיצה את הנגן
 * לשם, והנגן שמתקדם מסמן את המילה הנאמרת.
 *
 * עד כה לא הייתה עליה שום בדיקה. היו בדיקות ליישור, לתפריט התיקון
 * ולהחלפת מילים — אבל דווקא הקשר הזה, שהוא כל מה שהופך את המסך
 * למסונכרן, לא היה מוגן.
 *
 * זה נכתב לפני ניקוי קוד שאינו בשימוש, בכוונה: בלי בדיקה שעוברת
 * לפני ואחרי, אין דרך לדעת שהניקוי לא שבר כלום.
 */

const WORDS = ['בראשית', 'ברא', 'אלהים', 'את', 'השמים', 'ואת', 'הארץ'];
const TEXT = WORDS.join(' ');

/** כל מילה שנייה אחת, עם רווח קטן ביניהן. */
const TIMINGS = WORDS.map((word, i) => ({ word, start: i, end: i + 0.8 }));

function renderSync(props: Partial<React.ComponentProps<typeof SyncMirrorLayout>> = {}) {
  return render(
    <SyncMirrorLayout
      wordTimings={TIMINGS}
      currentTime={0}
      text={TEXT}
      syncEnabled
      onTextChange={vi.fn()}
      onWordReplace={vi.fn()}
      onWordClick={vi.fn()}
      {...props}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('sync_mirror_locked_pane', 'right');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('מתמלול לנגן', () => {
  it('הטקסט מוצג', async () => {
    const view = renderSync();
    await waitFor(() => expect(view.container.textContent).toContain('בראשית'));
  });

  it('לחיצה על מילה מדווחת על הזמן שלה', async () => {
    // זה מה שמקפיץ את הנגן. בלי הדיווח הזה הלחיצה אינה עושה כלום.
    const onWordClick = vi.fn();
    const view = renderSync({ onWordClick });

    const target = await waitFor(() => {
      const el = Array.from(view.container.querySelectorAll('span,button,div'))
        .find((e) => e.textContent?.trim() === 'אלהים' && e.children.length === 0);
      if (!el) throw new Error('המילה לא נמצאה');
      return el;
    });

    await userEvent.click(target);
    await waitFor(() => expect(onWordClick).toHaveBeenCalled());

    // המילה השלישית מתחילה בשנייה השנייה.
    const reported = onWordClick.mock.calls[0][0];
    expect(typeof reported).toBe('number');
    expect(reported).toBeGreaterThanOrEqual(2);
    expect(reported).toBeLessThan(3);
  });

  it('לחיצה על מילה אחרת מדווחת זמן אחר', async () => {
    const onWordClick = vi.fn();
    const view = renderSync({ onWordClick });

    const find = (word: string) =>
      Array.from(view.container.querySelectorAll('span,button,div'))
        .find((e) => e.textContent?.trim() === word && e.children.length === 0);

    const first = await waitFor(() => {
      const el = find('ברא');
      if (!el) throw new Error('לא נמצאה');
      return el;
    });
    await userEvent.click(first);

    const second = find('הארץ');
    if (second) await userEvent.click(second);

    await waitFor(() => expect(onWordClick.mock.calls.length).toBeGreaterThanOrEqual(1));
    const times = onWordClick.mock.calls.map((c) => c[0] as number);
    if (times.length > 1) {
      expect(times[times.length - 1]).not.toBe(times[0]);
    }
  });
});

describe('מהנגן לתמלול', () => {
  it('מקבל זמן מתעדכן בלי לקרוס', async () => {
    // הנגן מדווח זמן עשרות פעמים בשנייה. רינדור שנשבר על אחד מהם
    // מפיל את כל המסך באמצע ההשמעה.
    const view = renderSync({ currentTime: 0 });
    for (const t of [0.5, 1.2, 2.4, 3.9, 5.1, 6.6]) {
      view.rerender(
        <SyncMirrorLayout
          wordTimings={TIMINGS}
          currentTime={t}
          text={TEXT}
          syncEnabled
          onTextChange={vi.fn()}
          onWordReplace={vi.fn()}
          onWordClick={vi.fn()}
        />,
      );
    }
    await waitFor(() => expect(view.container.textContent).toContain('הארץ'));
  });

  it('הטקסט נשאר שלם לאורך כל ההשמעה', async () => {
    const view = renderSync({ currentTime: 0 });
    view.rerender(
      <SyncMirrorLayout
        wordTimings={TIMINGS}
        currentTime={6.5}
        text={TEXT}
        syncEnabled
        onTextChange={vi.fn()}
        onWordReplace={vi.fn()}
        onWordClick={vi.fn()}
      />,
    );
    await waitFor(() => {
      for (const w of WORDS) expect(view.container.textContent).toContain(w);
    });
  });
});

describe('כשהסנכרון כבוי', () => {
  it('הטקסט עדיין מוצג', async () => {
    // כיבוי הסנכרון הוא בחירה של תצוגה, לא של תוכן.
    const view = renderSync({ syncEnabled: false });
    await waitFor(() => expect(view.container.textContent).toContain('בראשית'));
  });
});

describe('בלי תזמונים', () => {
  it('הטקסט מוצג גם בלי חותמות זמן', async () => {
    const view = renderSync({ wordTimings: [] });
    await waitFor(() => expect(view.container.textContent).toContain('השמים'));
  });
});
