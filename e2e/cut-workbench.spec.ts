import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';
import type { Page } from '@playwright/test';

/**
 * שולחן העבודה של החיתוך: מד התקדמות, שמירת המצב בין לשוניות,
 * ואפשרויות השליחה אחרי החיתוך.
 *
 * שלושת הדברים האלה אפשר לבדוק רק בדפדפן אמיתי: המעבר בין לשוניות
 * מפרק את הרכיב באמת, והמסד המקומי של הדפדפן הוא זה שמחזיר אותו.
 */

const SAMPLE_RATE = 16000;

function toneWav(seconds: number, hz: number): Buffer {
  const numSamples = Math.round(seconds * SAMPLE_RATE);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i += 1) {
    buf.writeInt16LE(Math.round(11000 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)), 44 + i * 2);
  }
  return buf;
}

const WORDS = [
  { word: 'בראשית', start: 0.20, end: 0.90, probability: 0.97 },
  { word: 'ברא', start: 1.10, end: 1.60, probability: 0.96 },
  { word: 'אלוקים.', start: 1.80, end: 2.60, probability: 0.98 },
];

/** פותח את לשונית החיתוך עם קובץ טעון. */
async function openWithFile(page: Page, fileName = 'שיעור.wav') {
  await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /חיתוך/ }).click();
  await expect(page.getByTestId('cut-drop-zone')).toBeVisible({ timeout: 20000 });
  await page.getByTestId('cut-file-input').setInputFiles({
    name: fileName,
    mimeType: 'audio/wav',
    buffer: toneWav(3, 440),
  });
  await expect(page.getByTestId('visual-audio-editor')).toBeVisible({ timeout: 20000 });
  await closeCompletedPanel(page);
}

/** הלוח הצף "קבצים שהושלמו" נפתח מעל הדף ומכסה את הכפתורים. */
async function closeCompletedPanel(page: Page) {
  const panel = page.getByRole('dialog', { name: 'קבצים שהושלמו' });
  if (!(await panel.count())) return;
  const close = panel.getByRole('button', { name: /סגור|מזער/ });
  if (await close.count()) {
    await close.first().click({ timeout: 5000 }).catch(() => undefined);
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('שולחן העבודה של החיתוך', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
  });

  test('מד ההתקדמות מופיע בזמן התמלול, ולא רק אפס אחוז', async ({ page }) => {
    await mockLocalServer(page, {
      connected: true,
      durationSec: 3,
      text: 'בראשית ברא אלוקים.',
      wordTimings: WORDS,
      stagedProgress: true,
      stageDelayMs: 2500,
    });
    await openWithFile(page);

    await page.getByTestId('transcribe-for-cut').click();

    // מד ההתקדמות נראה כבר בזמן ההמתנה, עם שורת מצב שאומרת מה קורה
    const bar = page.getByTestId('cut-transcribe-progress');
    await expect(bar).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('cut-transcribe-stage')).toBeVisible();
    await expect(bar).toContainText('עבר');

    // ובסוף התמלול מגיע
    await expect(page.getByTestId('transcript-cut-area')).toBeVisible({ timeout: 30000 });
  });

  test('התמלול חוזר אחרי מעבר ללשונית אחרת וחזרה', async ({ page }) => {
    await mockLocalServer(page, {
      connected: true,
      durationSec: 3,
      text: 'בראשית ברא אלוקים.',
      wordTimings: WORDS,
    });
    await openWithFile(page, 'שיעור לשמירה.wav');

    await page.getByTestId('transcribe-for-cut').click();
    await expect(page.getByTestId('transcript-cut-area')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-word-index]')).toHaveCount(3);

    // יוצאים ללשונית אחרת — הרכיב מתפרק לגמרי
    await page.getByRole('tab', { name: /המרה/ }).click();
    await expect(page.getByTestId('cut-drop-zone')).toHaveCount(0);

    // וחוזרים
    await page.getByRole('tab', { name: /חיתוך/ }).click();

    // הקובץ והתמלול חזרו, בלי לתמלל שוב
    await expect(page.getByTestId('transcript-cut-area')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-word-index]')).toHaveCount(3);
    // שם הקובץ בשורת פרטי המקור, לא בהודעה הצפה
    await expect(page.getByTestId('cut-drop-zone').getByText('שיעור לשמירה.wav')).toBeVisible();
  });

  test('הקובץ חוזר גם אחרי רענון הדף', async ({ page }) => {
    await mockLocalServer(page, { connected: true, durationSec: 3 });
    await openWithFile(page, 'שיעור אחרי רענון.wav');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /חיתוך/ }).click();

    await expect(page.getByTestId('cut-drop-zone').getByText('שיעור אחרי רענון.wav'))
      .toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('visual-audio-editor')).toBeVisible();
  });

  test('אחרי חיתוך יש אפשרות שליחה, לקטע בודד ולכל הקטעים', async ({ page }) => {
    await mockLocalServer(page, {
      connected: true,
      durationSec: 3,
      text: 'בראשית ברא אלוקים.',
      wordTimings: WORDS,
    });
    await openWithFile(page, 'שיעור לחיתוך.wav');

    /*
      כפתור החיתוך פועל רק כשיש מה לחתוך. הדרך הקצרה לסמן קטע היא
      דרך רצועת המילים: תמלול, לחיצה על מילה, וייצוא.
    */
    await page.getByTestId('transcribe-for-cut').click();
    await expect(page.getByTestId('transcript-cut-area')).toBeVisible({ timeout: 30000 });
    await closeCompletedPanel(page);
    await page.locator('[data-word-index="1"]').click();
    await page.getByTestId('export-selection').click();
    await expect(page.getByText('1 אזורים מסומנים')).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: /^חתוך/ }).first().click();

    const rows = page.getByTestId('cut-result-row');
    await expect(rows.first()).toBeVisible({ timeout: 90000 });

    // תפריט שליחה לכל הקטעים
    await expect(page.getByTestId('deliver-all')).toBeVisible();
    await page.getByTestId('deliver-all').click();
    await expect(page.getByTestId('deliver-all-folder')).toBeVisible();
    await expect(page.getByTestId('deliver-all-folder')).toContainText('שמור לתיקייה במחשב');
    await page.keyboard.press('Escape');

    // ותפריט שליחה לקטע בודד
    await expect(page.getByTestId('deliver-result').first()).toBeVisible();
  });
});
