import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

/**
 * חיתוך לפי טקסט — בדיקה בדפדפן אמיתי.
 *
 * הבדיקות ביחידות בודקות חשבון וסימון על אודיו מלאכותי. כאן האודיו
 * מפוענח באמת בדפדפן, רכיב גלי הקול רץ באמת, וההצמדה לשקט נמדדת על
 * הדגימות האמיתיות של הקובץ — זה מה שאי אפשר לדמות.
 *
 * הקובץ בנוי בכוונה עם שתיקות:
 *   0.0–0.3  שקט
 *   0.3–1.0  צליל
 *   1.0–1.5  שקט
 *   1.5–2.5  צליל
 *   2.5–3.0  שקט
 * וזמן הסיום של המילה הראשונה נקבע ב-1.10 — בתוך השקט אבל לא בסופו,
 * בדיוק הטעות שמנוע התמלול עושה במציאות.
 */

const SAMPLE_RATE = 16000;

function createGappedToneWav(): Buffer {
  const blocks: Array<[number, number, number]> = [
    [0.0, 0.3, 0],
    [0.3, 1.0, 12000],
    [1.0, 1.5, 0],
    [1.5, 2.5, 12000],
    [2.5, 3.0, 0],
  ];
  const numSamples = Math.round(3.0 * SAMPLE_RATE);
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buf = Buffer.alloc(fileSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(fileSize - 8, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (const [from, to, amplitude] of blocks) {
    const start = Math.round(from * SAMPLE_RATE);
    const end = Math.round(to * SAMPLE_RATE);
    for (let i = start; i < end; i += 1) {
      const sample = amplitude ? Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)) : 0;
      buf.writeInt16LE(sample, 44 + i * 2);
    }
  }
  return buf;
}

const WORD_TIMINGS = [
  { word: 'הכדירה', start: 0.35, end: 1.10, probability: 0.95 },
  { word: 'חז״ל', start: 1.55, end: 2.00, probability: 0.98 },
  { word: 'אסרו.', start: 2.05, end: 2.45, probability: 0.93 },
];

test.describe.configure({ mode: 'serial' });

test.describe('חיתוך לפי טקסט בדף מרכז האודיו', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
    await mockLocalServer(page, {
      connected: true,
      wordTimings: WORD_TIMINGS,
      text: 'הכדירה חז״ל אסרו.',
      durationSec: 3,
    });
    // מדריך הפתיחה מכובה בתוך injectAuthSession, לכל הבדיקות
    await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
  });

  /** לוח "קבצים שהושלמו" צף מעל הדף אחרי שנוצר קובץ — סוגרים אותו. */
  async function closeFloatingPanels(page: import('@playwright/test').Page) {
    const close = page.getByRole('dialog', { name: 'קבצים שהושלמו' }).getByRole('button', { name: 'סגור' });
    if (await close.count()) {
      await close.first().click({ timeout: 5000 }).catch(() => {});
    }
  }

  /** מעלה את הקובץ לחיתוך ופותח את העורך החזותי. */
  async function openVisualEditor(page: import('@playwright/test').Page) {
    await page.getByRole('tab', { name: /חיתוך/ }).click();
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles({
      name: 'shiur-with-gaps.wav',
      mimeType: 'audio/wav',
      buffer: createGappedToneWav(),
    });
    await expect(page.getByTestId('visual-audio-editor')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('waveform-selection-area')).toBeVisible();
    await closeFloatingPanels(page);
  }

  test('לפני התמלול מוצעת האפשרות, ואין עוד רצועת מילים', async ({ page }) => {
    await openVisualEditor(page);
    await expect(page.getByTestId('transcribe-for-cut-bar')).toBeVisible();
    await expect(page.getByTestId('transcript-cut-area')).toHaveCount(0);
  });

  test('אחרי התמלול מופיעות המילים, ואפשר לקפוץ אליהן בנגן', async ({ page }) => {
    await openVisualEditor(page);
    await page.getByTestId('transcribe-for-cut').click();

    await expect(page.getByTestId('transcript-cut-area')).toBeVisible({ timeout: 30000 });
    const words = page.locator('[data-word-index]');
    await expect(words).toHaveCount(3);
    await expect(words.nth(0)).toHaveText('הכדירה');
    await expect(words.nth(2)).toHaveText('אסרו.');

    // ההצעה לתמלל נעלמת ברגע שיש תמלול
    await expect(page.getByTestId('transcribe-for-cut-bar')).toHaveCount(0);

    /**
     * לחיצה על המילה השנייה מזיזה את הנגן ל-1.55. הבדיקה סוגרת את
     * המעגל כולו: הלחיצה הזיזה את הנגן, הנגן דיווח על הזמן החדש,
     * והמילה הנאמרת התעדכנה לפיו.
     */
    await words.nth(1).click();
    await expect(words.nth(1)).toHaveAttribute('data-active', 'true', { timeout: 10000 });
    await expect(words.nth(0)).toHaveAttribute('data-active', 'false');
  });

  test('סימון משפט יוצר אזור חיתוך, והקצוות מוצמדים לשקט האמיתי של הקובץ', async ({ page }) => {
    await openVisualEditor(page);
    await page.getByTestId('transcribe-for-cut').click();
    await expect(page.getByTestId('transcript-cut-area')).toBeVisible({ timeout: 30000 });

    // מפתח ההצמדה נדלק רק אחרי שהאודיו פוענח באמת בדפדפן
    await expect(page.getByTestId('snap-toggle')).toBeEnabled({ timeout: 15000 });

    // לחיצה כפולה על מילה מסמנת את המשפט כולו
    await page.locator('[data-word-index="0"]').dblclick();
    await expect(page.getByTestId('word-selection-bar')).toBeVisible();

    await page.getByTestId('mark-selection').click();

    // נוצר אזור חיתוך אחד
    await expect(page.getByText('1 אזורים מסומנים')).toBeVisible({ timeout: 10000 });
    // והמערכת מדווחת שהקצוות הוזזו אל השקט
    await expect(page.getByTestId('snap-note')).toContainText('הוזזו לשקט');
  });

  test('אזור שנוצר מהטקסט אפשר לכוונן בכפתורים', async ({ page }) => {
    await openVisualEditor(page);
    await page.getByTestId('transcribe-for-cut').click();
    await expect(page.getByTestId('transcript-cut-area')).toBeVisible({ timeout: 30000 });

    await page.locator('[data-word-index="1"]').click();
    await page.getByTestId('mark-selection').click();
    await expect(page.getByText('1 אזורים מסומנים')).toBeVisible({ timeout: 10000 });

    await expect(page.getByTestId('nudge-start-back')).toBeVisible();
    await expect(page.getByTestId('nudge-end-forward')).toBeVisible();

    const times = page.getByTestId('range-times').first();
    const before = (await times.textContent()) ?? '';
    // חמש לחיצות = רבע שנייה, שינוי שבטוח נראה בתצוגה של עשיריות
    for (let i = 0; i < 5; i += 1) {
      await page.getByTestId('nudge-end-forward').click();
    }
    await expect(times).not.toHaveText(before, { timeout: 10000 });
  });

  test('המילים שבתוך האזור המסומן נראות מסומנות גם ברצועה', async ({ page }) => {
    await openVisualEditor(page);
    await page.getByTestId('transcribe-for-cut').click();
    await expect(page.getByTestId('transcript-cut-area')).toBeVisible({ timeout: 30000 });

    await page.locator('[data-word-index="1"]').click();
    await page.getByTestId('mark-selection').click();
    await expect(page.getByText('1 אזורים מסומנים')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('[data-word-index="1"]')).toHaveAttribute('data-marked', 'true');
    await expect(page.locator('[data-word-index="0"]')).toHaveAttribute('data-marked', 'false');
  });
});
