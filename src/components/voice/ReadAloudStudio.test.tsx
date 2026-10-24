import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReadAloudStudio from './ReadAloudStudio';

const toastCalls: Array<{ title?: string; description?: string; variant?: string }> = [];
vi.mock('@/hooks/use-toast', () => ({
  toast: (args: { title?: string; description?: string; variant?: string }) => {
    toastCalls.push(args);
  },
  useToast: () => ({ toast: () => {}, dismiss: () => {}, toasts: [] }),
}));

/**
 * סביבת הבדיקה אינה מכילה מנוע הקראה אמיתי, ולכן אנחנו שמים במקומו
 * מנוע מדומה שרושם מה נשלח אליו. זה בדיוק מה שצריך לבדוק כאן: שהטקסט
 * שנשלח להקראה הוא הטקסט בכתיב האשכנזי ולא הטקסט המקורי.
 *
 * אם המערכת תשלח את הטקסט המקורי, ההקראה תישמע ישראלית והמשתמש יראה
 * מתג דלוק שאינו עושה כלום — בדיוק סוג הכשל שלא מתגלה במבט בממשק.
 */
interface FakeUtterance {
  text: string;
  voice: unknown;
  lang: string;
  rate: number;
  pitch: number;
  volume: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onboundary: ((e: { charIndex: number }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

let spoken: FakeUtterance[] = [];
let cancelled = 0;

function installFakeSpeech() {
  spoken = [];
  cancelled = 0;

  class FakeSpeechSynthesisUtterance implements FakeUtterance {
    text: string;
    voice: unknown = null;
    lang = '';
    rate = 1;
    pitch = 1;
    volume = 1;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onboundary: ((e: { charIndex: number }) => void) | null = null;
    onerror: ((e: { error: string }) => void) | null = null;
    constructor(text: string) { this.text = text; }
  }

  const voices = [
    { name: 'Carmit', lang: 'he-IL', localService: true, default: true, voiceURI: 'carmit' },
    { name: 'Daniel', lang: 'en-GB', localService: true, default: false, voiceURI: 'daniel' },
  ];

  const synth = {
    speaking: false,
    paused: false,
    pending: false,
    onvoiceschanged: null as (() => void) | null,
    getVoices: () => voices,
    speak: (u: FakeUtterance) => {
      spoken.push(u);
      synth.speaking = true;
      u.onstart?.();
    },
    cancel: () => { cancelled += 1; synth.speaking = false; },
    pause: () => { synth.paused = true; },
    resume: () => { synth.paused = false; },
  };

  vi.stubGlobal('speechSynthesis', synth);
  vi.stubGlobal('SpeechSynthesisUtterance', FakeSpeechSynthesisUtterance);
  return synth;
}

beforeEach(() => {
  installFakeSpeech();
  toastCalls.length = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('אולפן ההקראה', () => {
  it('נטען ומציג את מנוע ההקראה ואת הטקסט', async () => {
    render(<ReadAloudStudio />);
    expect(screen.getByText('מנוע ההקראה')).toBeTruthy();
    expect(screen.getByText('הטקסט להקראה')).toBeTruthy();
    expect(screen.getByRole('button', { name: /הקרא/ })).toBeTruthy();
  });

  it('מוצא את הקול העברי ומדווח כמה נמצאו', async () => {
    render(<ReadAloudStudio />);
    await waitFor(() => {
      expect(screen.getByText(/1 קולות עבריים מתוך 2 שנמצאו/)).toBeTruthy();
    });
  });

  it('שולח להקראה את הטקסט בכתיב אשכנזי ולא את המקורי', async () => {
    const user = userEvent.setup();
    render(<ReadAloudStudio />);

    const textbox = screen.getByPlaceholderText('הדביקו כאן טקסט מנוקד');
    await user.clear(textbox);
    await user.type(textbox, 'תּוֹרָה');

    await user.click(screen.getByRole('button', { name: /^הקרא$/ }));

    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('תוירה');
    expect(spoken[0].text).not.toBe('תּוֹרָה');
  });

  it('שולח את הטקסט המקורי כשהמתג האשכנזי כבוי', async () => {
    const user = userEvent.setup();
    render(<ReadAloudStudio />);

    const textbox = screen.getByPlaceholderText('הדביקו כאן טקסט מנוקד');
    await user.clear(textbox);
    await user.type(textbox, 'תּוֹרָה');

    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: /^הקרא$/ }));

    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('תּוֹרָה');
  });

  it('בוחר את הקול העברי ולא את האנגלי', async () => {
    const user = userEvent.setup();
    render(<ReadAloudStudio />);
    await waitFor(() => expect(screen.getByText(/קולות עבריים/)).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /^הקרא$/ }));
    expect((spoken[0].voice as { name: string }).name).toBe('Carmit');
    expect(spoken[0].lang).toBe('he-IL');
  });

  it('מזהיר כשהטקסט אינו מנוקד אף שהמתג האשכנזי דלוק', async () => {
    const user = userEvent.setup();
    render(<ReadAloudStudio />);

    const textbox = screen.getByPlaceholderText('הדביקו כאן טקסט מנוקד');
    await user.clear(textbox);
    await user.type(textbox, 'שלום עולם');

    // בלי האזהרה הזאת המשתמש רואה מתג דלוק ומקבל עברית ישראלית.
    await waitFor(() => {
      expect(screen.getByText(/הטקסט אינו מנוקד/)).toBeTruthy();
    });
  });

  it('מדווח כמה מילים נכתבו מחדש', async () => {
    render(<ReadAloudStudio />);
    // טקסט ההתחלה מנוקד במלואו, ולכן חייב להופיע דיווח ולא אזהרה.
    await waitFor(() => {
      expect(screen.getByText(/מילים נכתבו\s*מחדש להגייה אשכנזית/)).toBeTruthy();
    });
  });

  it('מעביר את המהירות וגובה הקול למנוע', async () => {
    const user = userEvent.setup();
    render(<ReadAloudStudio />);
    await user.click(screen.getByRole('button', { name: /^הקרא$/ }));
    // ברירת המחדל היא 0.9, כי קריאה של שיעור בקצב 1 נשמעת ממוהרת.
    expect(spoken[0].rate).toBe(0.9);
    expect(spoken[0].pitch).toBe(1);
  });

  it('מדגיש את המילה הנקראת לפי דיווח המנוע', async () => {
    const user = userEvent.setup();
    render(<ReadAloudStudio />);

    const textbox = screen.getByPlaceholderText('הדביקו כאן טקסט מנוקד');
    await user.clear(textbox);
    await user.type(textbox, 'שַׁבָּת שָׁלוֹם');
    await user.click(screen.getByRole('button', { name: /^הקרא$/ }));

    const utterance = spoken[0];
    expect(utterance.onboundary).toBeTruthy();

    // המילה השנייה מתחילה אחרי הרווח. מקום התו שמדווח המנוע חייב
    // להתרגם למילה השנייה, לא לראשונה.
    const secondWordStart = utterance.text.indexOf(' ') + 1;
    utterance.onboundary?.({ charIndex: secondWordStart });

    await waitFor(() => {
      const highlighted = document.querySelectorAll('[aria-current="true"]');
      expect(highlighted.length).toBe(1);
      expect(highlighted[0].textContent?.trim()).toBe(utterance.text.split(' ')[1]);
    });
  });

  it('מציג הסבר בעברית כשההקראה נכשלת', async () => {
    const user = userEvent.setup();
    render(<ReadAloudStudio />);
    await user.click(screen.getByRole('button', { name: /^הקרא$/ }));
    spoken[0].onerror?.({ error: 'language-unavailable' });
    await waitFor(() => {
      expect(toastCalls).toHaveLength(1);
      expect(toastCalls[0].description).toMatch(/אין במערכת קול שמתאים לעברית/);
      expect(toastCalls[0].variant).toBe('destructive');
    });
  });

  it('אינו מציג שגיאה כשהמשתמש עצר בעצמו', async () => {
    const user = userEvent.setup();
    render(<ReadAloudStudio />);
    await user.click(screen.getByRole('button', { name: /^הקרא$/ }));
    // עצירה מכוונת מגיעה מהדפדפן כשגיאה. אסור להציג אותה כתקלה.
    spoken[0].onerror?.({ error: 'canceled' });
    await new Promise((r) => setTimeout(r, 50));
    expect(toastCalls).toHaveLength(0);
  });

  it('מציג את המנועים שנפסלו עם הסיבה', () => {
    render(<ReadAloudStudio />);
    expect(screen.getByText('מנועים שנבדקו ונפסלו')).toBeTruthy();
    expect(screen.getByText(/פי שניים מהזיכרון הזמין/)).toBeTruthy();
  });

  it('מציג את כפתור ההקלטה', () => {
    render(<ReadAloudStudio />);
    expect(screen.getByRole('button', { name: /התחל הקלטה/ })).toBeTruthy();
  });
});
