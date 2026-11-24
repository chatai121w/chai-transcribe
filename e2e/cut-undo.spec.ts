import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';
import type { Page } from '@playwright/test';

/**
 * ביטול פעולה בסימוני החיתוך, ואיקון שמחזיר קטע מוכן לחיתוך לפי הטקסט.
 *
 * הסימונים חיים בתוך רכיב גלי הקול ולא במשתנה של המסך, ולכן אי אפשר
 * לבדוק את זה בבדיקת יחידה — צריך דפדפן אמיתי שבו הרכיב באמת רץ.
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

async function closeCompletedPanel(page: Page) {
  const panel = page.getByRole('dialog', { name: 'קבצים שהושלמו' });
  if (!(await panel.count())) return;
  const close = panel.getByRole('button', { name: /סגור|מזער/ });
  if (await close.count()) await close.first().click({ timeout: 5000 }).catch(() => undefined);
}

async function openEditor(page: Page, seconds = 9) {
  await mockSupabase(page, { authenticated: true });
  await injectAuthSession(page);
  await mockLocalServer(page, { connected: true, durationSec: seconds });

  await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /חיתוך/ }).click();
  await expect(page.getByTestId('cut-drop-zone')).toBeVisible({ timeout: 20000 });

  await page.getByTestId('cut-file-input').setInputFiles({
    name: 'שיעור ארוך.wav',
    mimeType: 'audio/wav',
    buffer: toneWav(seconds, 440),
  });
  await expect(page.getByTestId('visual-audio-editor')).toBeVisible({ timeout: 25000 });
  await closeCompletedPanel(page);
}

/**
 * מסמן אזור: לחיצה על צורת הגל קובעת את מקום הסמן, ואז "הוסף באזור הסמן".
 * זו הדרך שבדיקות קיימות כבר מוכיחות שעובדת, ולא גרירה על הגל.
 */
async function addMark(page: Page, atRatio: number) {
  const wave = page.getByTestId('waveform-selection-area');
  await expect(wave.locator('canvas').first()).toBeVisible({ timeout: 20000 });
  const box = await wave.boundingBox();
  if (!box) throw new Error('צורת הגל לא נמצאה על המסך');
  await page.mouse.click(box.x + box.width * atRatio, box.y + box.height * 0.45);
  await page.getByRole('button', { name: 'הוסף באזור הסמן' }).click();
}

function markCount(page: Page) {
  return page.getByText(/\d+ אזורים מסומנים/);
}

test.describe.configure({ mode: 'serial' });

test.describe('ביטול פעולה בסימוני החיתוך', () => {
  test('בהתחלה אין מה לבטל', async ({ page }) => {
    await openEditor(page);
    await expect(page.getByTestId('cut-undo')).toBeDisabled();
    await expect(page.getByTestId('cut-redo')).toBeDisabled();
  });

  test('ביטול מסיר את הסימון האחרון, וחזרה מחזירה אותו', async ({ page }) => {
    await openEditor(page);

    await addMark(page, 0.12);
    await expect(markCount(page)).toContainText('1 אזורים מסומנים');
    await expect(page.getByTestId('cut-undo')).toBeEnabled();

    await page.getByTestId('cut-undo').click();
    await expect(page.getByText('עדיין אין סימונים')).toBeVisible();

    await expect(page.getByTestId('cut-redo')).toBeEnabled();
    await page.getByTestId('cut-redo').click();
    await expect(markCount(page)).toContainText('1 אזורים מסומנים');
  });

  test('שני סימונים — שתי לחיצות ביטול מחזירות לריק', async ({ page }) => {
    await openEditor(page);

    await addMark(page, 0.08);
    await expect(markCount(page)).toContainText('1 אזורים מסומנים');
    await addMark(page, 0.6);
    await expect(markCount(page)).toContainText('2 אזורים מסומנים');

    await page.getByTestId('cut-undo').click();
    await expect(markCount(page)).toContainText('1 אזורים מסומנים');
    await page.getByTestId('cut-undo').click();
    await expect(page.getByText('עדיין אין סימונים')).toBeVisible();
  });

  /* זה המקרה הכואב: לחיצה אחת מוחקת את כל העבודה. */
  test('ניקוי כל הסימונים אפשר לבטל', async ({ page }) => {
    await openEditor(page);

    await addMark(page, 0.08);
    await addMark(page, 0.6);
    await expect(markCount(page)).toContainText('2 אזורים מסומנים');

    await page.getByTestId('cut-clear-all').click();
    await expect(page.getByText('עדיין אין סימונים')).toBeVisible();

    await page.getByTestId('cut-undo').click();
    await expect(markCount(page)).toContainText('2 אזורים מסומנים');
  });

  test('מחיקת סימון בודד אפשר לבטל', async ({ page }) => {
    await openEditor(page);

    await addMark(page, 0.08);
    await addMark(page, 0.6);
    await expect(markCount(page)).toContainText('2 אזורים מסומנים');

    await page.getByRole('button', { name: 'מחק סימון' }).first().click();
    await expect(markCount(page)).toContainText('1 אזורים מסומנים');

    await page.getByTestId('cut-undo').click();
    await expect(markCount(page)).toContainText('2 אזורים מסומנים');
  });

  test('מקש הביטול במקלדת עובד גם הוא', async ({ page }) => {
    await openEditor(page);

    await addMark(page, 0.12);
    await expect(markCount(page)).toContainText('1 אזורים מסומנים');

    await page.keyboard.press('Control+z');
    await expect(page.getByText('עדיין אין סימונים')).toBeVisible();

    await page.keyboard.press('Control+Shift+z');
    await expect(markCount(page)).toContainText('1 אזורים מסומנים');
  });

  test('סימון חדש אחרי ביטול מבטל את האפשרות לחזור קדימה', async ({ page }) => {
    await openEditor(page);

    await addMark(page, 0.12);
    await page.getByTestId('cut-undo').click();
    await expect(page.getByTestId('cut-redo')).toBeEnabled();

    await addMark(page, 0.6);
    await expect(markCount(page)).toContainText('1 אזורים מסומנים');
    await expect(page.getByTestId('cut-redo')).toBeDisabled();
  });
});

test.describe('החזרת קטע לחיתוך לפי התמלול', () => {
  test('בכל שורת תוצאה יש גם תמלול רגיל וגם החזרה לחיתוך', async ({ page }) => {
    await openEditor(page);

    await page.getByRole('button', { name: '3 חלקים' }).click();
    await page.getByRole('button', { name: /^חתוך/ }).first().click();
    await expect(page.getByTestId('cut-result-row')).toHaveCount(3, { timeout: 90000 });
    await closeCompletedPanel(page);

    // שני האיקונים, בכל אחת מהשורות
    await expect(page.getByTestId('transcribe-result')).toHaveCount(3);
    await expect(page.getByTestId('recut-by-transcript')).toHaveCount(3);
  });

  test('לחיצה על ההחזרה טוענת את הקטע לשולחן העבודה', async ({ page }) => {
    await openEditor(page);

    await page.getByRole('button', { name: '2 חלקים' }).click();
    await page.getByRole('button', { name: /^חתוך/ }).first().click();
    await expect(page.getByTestId('cut-result-row')).toHaveCount(2, { timeout: 90000 });
    await closeCompletedPanel(page);

    const firstName = await page.getByTestId('cut-result-row').first()
      .locator('.text-sm.font-medium').first().innerText();

    // חותכים "לפי מספר", כדי לוודא שההחזרה באמת מחליפה את מצב העורך
    await expect(page.getByTestId('visual-audio-editor')).toHaveCount(0);

    await page.getByTestId('recut-by-transcript').first().click();

    // הקטע חזר לשולחן העבודה, והמסך עבר למצב החזותי שבו יש חיתוך לפי טקסט
    await expect(page.getByTestId('visual-audio-editor')).toBeVisible({ timeout: 25000 });
    await expect(page.getByTestId('transcribe-for-cut-bar')).toBeVisible();
    await expect(page.getByText(firstName.trim()).first()).toBeVisible({ timeout: 20000 });
  });
});
