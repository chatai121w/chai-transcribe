import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * מסך המדידות.
 *
 * הבדיקות כאן אינן על "האם הרכיב נטען". הן על ההבטחות שהוא נותן,
 * וכל אחת מהן נובעת ממלכודת מתועדת במדידת איכות:
 *
 *   השיא תמיד מוצג       אחרת ההשוואה היא למדידה הקודמת, והמקרה
 *                        60 ירידה ל-50 עלייה ל-55 נראה כשיפור.
 *
 *   קבוצות מופרדות       מדידות על מספר מילים אחר, על טקסטי הפניה
 *                        אחרים או בכלל נרמול אחר אינן בנות
 *                        השוואה. הצגתן יחד מזמינה את הטעות.
 *
 *   מה שלא נמדד נאמר     לוח שמציג רק את מה שנמדד יוצר רושם
 *                        שהכול מכוסה.
 *
 * רכיב הגרף מוחלף כאן בכוונה: הוא מודד את רוחב המכולה, ובסביבת
 * הבדיקה הרוחב הוא אפס ושום דבר לא היה מצויר. מה שנבדק הוא
 * ההיגיון, לא הציור.
 */

vi.mock('recharts', async () => {
  const React = await import('react');
  const Pass = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  return {
    ResponsiveContainer: Pass,
    LineChart: Pass,
    Line: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    // הקו המקווקו של השיא — מוצג כטקסט כדי שאפשר יהיה לבדוק אותו
    ReferenceLine: ({ label }: { label?: { value?: string } }) =>
      React.createElement('div', null, label?.value ?? ''),
  };
});

const fetchLocalServer = vi.fn();
vi.mock('@/lib/serverConfig', () => ({
  getServerUrl: () => 'http://127.0.0.1:3000',
  fetchLocalServer: (...a: unknown[]) => fetchLocalServer(...a),
}));

import { MeasurementsPanel } from './MeasurementsPanel';

const PAYLOAD = {
  howToMeasure: 'python scripts/regression_check.py --save <שם> --topic <נושא>',
  notMeasured: [
    { key: 'ashkenazi-pronunciation', label: 'הגייה אשכנזית' },
    { key: 'speaker-id', label: 'זיהוי מי מדבר' },
  ],
  lessons: [
    {
      label: 'כלל איחוד כתיב רחב מדי',
      stamp: '2026-10-25 16:00:00',
      hypothesis: 'חשבנו שזה שווה 8 נקודות',
      outcome: 'בפועל 2',
      lesson: 'כלל רחב מסתיר שגיאות אמיתיות',
      verdict: 'אומץ',
    },
  ],
  topics: [
    {
      key: 'modern-hebrew',
      label: 'עברית מודרנית',
      count: 3,
      latest: null,
      groups: [
        {
          words: 349, benchmark: null, normalisation: null, benchmarkKnown: false,
          best: { label: 'הבסיס', stamp: '2026-10-25 00:01:05', correct: 272, percent: 77.94 },
          rows: [
            { label: 'הבסיס', stamp: '2026-10-25 00:01:05', correct: 272, words: 349, percent: 77.94 },
            { label: 'ירידה', stamp: '2026-10-25 00:11:30', correct: 250, words: 349, percent: 71.63 },
          ],
        },
        {
          words: 349, benchmark: '940f4b0c899e', normalisation: '25c4a4291cf9', benchmarkKnown: true,
          best: { label: 'הפניה-מתוקנת', stamp: '2026-10-25 15:00:00', correct: 276, percent: 79.08 },
          rows: [
            {
              label: 'הפניה-מתוקנת', stamp: '2026-10-25 15:00:00',
              correct: 276, words: 349, percent: 79.08,
              machine_verdict: 'תחת עומס',
            },
          ],
        },
      ],
    },
  ],
};

const MEMORY = {
  gpu: { used: 5200, total: 8151 },
  transcriptionModels: ['ivrit-ai/whisper-large-v3-ct2'],
  transcriptionTtlMinutes: 30,
  ttsLoaded: true,
  ttsIdleSeconds: 900,
  ttsTtlMinutes: 60,
};

/** המסך פונה לשתי כתובות שונות, ולכל אחת מבנה תשובה אחר. */
function route(mem: unknown = MEMORY, data: unknown = PAYLOAD) {
  fetchLocalServer.mockImplementation((url: string) =>
    Promise.resolve(
      String(url).includes('/memory')
        ? { ok: true, json: async () => mem }
        : { ok: true, json: async () => data },
    ),
  );
}

beforeEach(() => {
  fetchLocalServer.mockReset();
  route();
});
afterEach(cleanup);

describe('השיא ההיסטורי', () => {
  it('מוצג על הגרף, ולא המדידה הקודמת', async () => {
    // זאת ההבטחה המרכזית של המסך. בלעדיה אין לו טעם.
    render(<MeasurementsPanel />);
    await waitFor(() => expect(screen.getByText(/השיא 78/)).toBeTruthy());
    expect(screen.getByText(/השיא 79/)).toBeTruthy();
  });

  it('המדידה שהיא השיא מסומנת ברשימה', async () => {
    render(<MeasurementsPanel />);
    await waitFor(() => expect(screen.getAllByText('השיא').length).toBeGreaterThan(0));
  });

  it('נאמר במפורש שהקו הוא השיא ולא הקודמת', async () => {
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('השיא ההיסטורי'));
    expect(view.container.textContent).toContain('לא המדידה הקודמת');
  });
});

describe('קבוצות שאסור להשוות ביניהן', () => {
  it('מוצגת אזהרה כשיש יותר מקבוצה אחת', async () => {
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('2 קבוצות נפרדות'));
    expect(view.container.textContent).toContain('אסור להשוות');
  });

  it('האזהרה אינה מוצגת כשיש קבוצה אחת בלבד', async () => {
    // אזהרה שמופיעה תמיד מפסיקה להיקרא.
    const one = {
      ...PAYLOAD,
      topics: [{ ...PAYLOAD.topics[0], groups: [PAYLOAD.topics[0].groups[0]] }],
    };
    route(MEMORY, one);
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('עברית מודרנית'));
    expect(view.container.textContent).not.toContain('אסור להשוות');
  });

  it('לכל קבוצה נאמר על אילו נתונים נמדדה', async () => {
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('940f4b0c899e'));
    // קבוצה ישנה בלי טביעת אצבע — חייב להיאמר ולא להישאר ריק
    expect(view.container.textContent).toContain('לא נרשמו');
  });
});

describe('מה שלא נמדד', () => {
  it('מופיע בשמו', async () => {
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('הגייה אשכנזית'));
    expect(view.container.textContent).toContain('זיהוי מי מדבר');
    expect(view.container.textContent).toContain('לא נמדדו');
  });

  it('מוצגת הפקודה שמודדת אותו', async () => {
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('regression_check.py'));
  });
});

describe('תנאי המדידה', () => {
  it('מדידה שנלקחה תחת עומס מסומנת', async () => {
    // מספר מהירות שנמדד תחת עומס אינו בר-השוואה, וזה חייב להיראות.
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('נמדד תחת עומס'));
  });

  it('נאמר שציר האחוזים אינו מתחיל באפס', async () => {
    // ציר חתוך בלי אמירה הופך תנודה זניחה לנראית כאסון.
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('אינו מתחיל באפס'));
  });
});

describe('יומן הלקחים', () => {
  it('מוצג עם מה ציפינו ומה קרה', async () => {
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('כלל איחוד כתיב רחב מדי'));
    expect(view.container.textContent).toContain('חשבנו שזה שווה 8 נקודות');
    expect(view.container.textContent).toContain('בפועל 2');
  });
});

describe('כשהשרת אינו פועל', () => {
  it('נאמר מה הבעיה ולא נשאר מסך ריק', async () => {
    fetchLocalServer.mockRejectedValue(new Error('Failed to fetch'));
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('שרת התמלול אינו פועל'));
  });
});


describe('מצב הזיכרון', () => {
  it('מציג מה טעון וכמה תפוס', async () => {
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('מה טעון בזיכרון'));
    expect(view.container.textContent).toContain('5.1 מתוך 8 ג׳יגה');
    expect(view.container.textContent).toContain('15 דקות ללא שימוש');
  });

  it('כפתור השחרור פעיל כשיש מה לשחרר', async () => {
    render(<MeasurementsPanel />);
    const btn = await screen.findByRole('button', { name: 'שחרר עכשיו' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('הכפתור כבוי כששום דבר אינו טעון', async () => {
    // כפתור שנראה פעיל ואינו עושה דבר הוא גרוע מכפתור כבוי.
    route({ ...MEMORY, transcriptionModels: [], ttsLoaded: false, ttsIdleSeconds: null });
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('אין מה לשחרר'));
    const btn = screen.getByRole('button', { name: 'שחרר עכשיו' });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('נאמר שהשחרור עולה בטעינה מחדש', async () => {
    // בלי זה אפשר לחשוב שהשחרור חינם.
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('ישלם על הטעינה מחדש'));
  });

  it('תשובה לא מוכרת אינה מפילה את המסך', async () => {
    // זאת התקלה שהבדיקות תפסו: שרת ישן מחזיר מבנה אחר, והרכיב
    // קרס ולקח איתו גם את המדידות, שאין להן שום קשר.
    route({ something: 'else' });
    const view = render(<MeasurementsPanel />);
    await waitFor(() => expect(view.container.textContent).toContain('עברית מודרנית'));
    expect(view.container.textContent).not.toContain('מה טעון בזיכרון');
  });
});
