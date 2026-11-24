import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';
import type { Page } from '@playwright/test';

/**
 * העלאת קבצים לאזור החיתוך: גרירה, כמה קבצים יחד, ותיקייה שלמה.
 *
 * גרירה אי אפשר לבדוק ברצינות מחוץ לדפדפן — צריך אירוע גרירה אמיתי
 * עם קבצים אמיתיים. לכן הבדיקה הזאת רצה בדפדפן ולא ביחידות.
 */

const SAMPLE_RATE = 16000;

/** קובץ צליל קצר ותקין, כדי שהמערכת תצליח לקרוא ממנו אורך. */
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

interface DropFile { name: string; type: string; bytes: number[] }

/** מדמה גרירה אמיתית של קבצים אל האזור. */
async function dropFiles(page: Page, files: DropFile[]) {
  const handle = await page.evaluateHandle((payload: DropFile[]) => {
    const transfer = new DataTransfer();
    for (const item of payload) {
      transfer.items.add(new File([new Uint8Array(item.bytes)], item.name, { type: item.type }));
    }
    return transfer;
  }, files);

  const zone = page.getByTestId('cut-drop-zone');
  await zone.dispatchEvent('dragover', { dataTransfer: handle });
  await zone.dispatchEvent('drop', { dataTransfer: handle });
}

function asDropFile(name: string, type: string, buffer: Buffer): DropFile {
  return { name, type, bytes: Array.from(buffer) };
}

test.describe.configure({ mode: 'serial' });

/** תיקייה אמיתית בדיסק, הדרך היחידה לבדוק בחירת תיקייה. */
const sampleFolder = join(process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results', 'תיקיית-שיעורים');

test.describe('העלאת קבצים לחיתוך', () => {
  test.beforeAll(() => {
    mkdirSync(sampleFolder, { recursive: true });
    writeFileSync(join(sampleFolder, 'שיעור 1.wav'), toneWav(2, 300));
    writeFileSync(join(sampleFolder, 'שיעור 2.wav'), toneWav(2, 600));
    writeFileSync(join(sampleFolder, 'רשימה.txt'), 'לא אודיו');
  });

  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /חיתוך/ }).click();
    await expect(page.getByTestId('cut-drop-zone')).toBeVisible({ timeout: 20000 });
  });

  test('אזור הגרירה מוצג עם שני הכפתורים', async ({ page }) => {
    await expect(page.getByTestId('cut-drop-hint')).toContainText('גרור לכאן');
    await expect(page.getByRole('button', { name: 'בחר קבצים' })).toBeVisible();
    await expect(page.getByTestId('cut-pick-folder')).toBeVisible();
  });

  test('האזור מסמן את עצמו בזמן גרירה', async ({ page }) => {
    const zone = page.getByTestId('cut-drop-zone');
    await expect(zone).toHaveAttribute('data-dragging', 'false');

    const handle = await page.evaluateHandle(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array([1, 2, 3])], 'שיעור.wav', { type: 'audio/wav' }));
      return transfer;
    });
    await zone.dispatchEvent('dragover', { dataTransfer: handle });

    await expect(zone).toHaveAttribute('data-dragging', 'true');
    await expect(page.getByTestId('cut-drop-hint')).toContainText('עזוב כאן');
  });

  test('גרירת קובץ אחד פותחת אותו לעריכה', async ({ page }) => {
    await dropFiles(page, [asDropFile('שיעור א.wav', 'audio/wav', toneWav(2, 440))]);

    await expect(page.getByTestId('visual-audio-editor')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('שיעור א.wav')).toBeVisible();
    // קובץ בודד אינו מייצר רשימת מעבר
    await expect(page.getByTestId('cut-file-queue')).toHaveCount(0);
  });

  test('גרירת כמה קבצים טוענת את הראשון ושומרת את השאר ברשימה', async ({ page }) => {
    await dropFiles(page, [
      asDropFile('שיעור ג.wav', 'audio/wav', toneWav(2, 300)),
      asDropFile('שיעור א.wav', 'audio/wav', toneWav(2, 600)),
      asDropFile('שיעור ב.wav', 'audio/wav', toneWav(2, 900)),
    ]);

    const queue = page.getByTestId('cut-file-queue');
    await expect(queue).toBeVisible({ timeout: 20000 });
    await expect(queue).toContainText('3 קבצים נטענו');

    // הסדר הוא לפי שם, ולא לפי סדר הגרירה המקרי
    const items = page.getByTestId('cut-queue-item');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('שיעור א.wav');
    await expect(items.nth(2)).toContainText('שיעור ג.wav');

    // והראשון הוא זה שנפתח
    await expect(items.nth(0)).toHaveAttribute('data-current', 'true');
  });

  test('לחיצה ברשימה מחליפה את הקובץ שבעריכה', async ({ page }) => {
    await dropFiles(page, [
      asDropFile('שיעור א.wav', 'audio/wav', toneWav(2, 300)),
      asDropFile('שיעור ב.wav', 'audio/wav', toneWav(3, 600)),
    ]);

    const items = page.getByTestId('cut-queue-item');
    await expect(items).toHaveCount(2, { timeout: 20000 });

    await items.nth(1).click();

    await expect(items.nth(1)).toHaveAttribute('data-current', 'true', { timeout: 15000 });
    await expect(items.nth(0)).toHaveAttribute('data-current', 'false');
  });

  test('קובץ שאינו אודיו נדחה, והמערכת אומרת זאת', async ({ page }) => {
    await dropFiles(page, [asDropFile('הערות.txt', 'text/plain', Buffer.from('שלום'))]);

    await expect(page.getByText('לא נמצא קובץ מתאים')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('visual-audio-editor')).toHaveCount(0);
  });

  test('גרירה מעורבת לוקחת רק את האודיו', async ({ page }) => {
    await dropFiles(page, [
      asDropFile('שיעור.wav', 'audio/wav', toneWav(2, 440)),
      asDropFile('קרא אותי.txt', 'text/plain', Buffer.from('טקסט')),
      asDropFile('תמונה.png', 'image/png', Buffer.from([137, 80, 78, 71])),
    ]);

    await expect(page.getByTestId('visual-audio-editor')).toBeVisible({ timeout: 20000 });
    // קובץ אודיו אחד בלבד — ולכן אין רשימת מעבר
    await expect(page.getByTestId('cut-file-queue')).toHaveCount(0);
  });

  test('בחירת תיקייה טוענת את כל קבצי האודיו שבה', async ({ page }) => {
    // בחירת תיקייה דורשת תיקייה אמיתית בדיסק, ולא רשימת קבצים בזיכרון
    await page.getByTestId('cut-folder-input').setInputFiles(sampleFolder);

    const queue = page.getByTestId('cut-file-queue');
    await expect(queue).toBeVisible({ timeout: 20000 });
    await expect(queue).toContainText('2 קבצים נטענו');
    await expect(page.getByTestId('cut-queue-item')).toHaveCount(2);
  });

  test('אפשר לנקות את רשימת הקבצים', async ({ page }) => {
    await dropFiles(page, [
      asDropFile('שיעור א.wav', 'audio/wav', toneWav(2, 300)),
      asDropFile('שיעור ב.wav', 'audio/wav', toneWav(2, 600)),
    ]);

    await expect(page.getByTestId('cut-file-queue')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('cut-queue-clear').click();

    await expect(page.getByTestId('cut-file-queue')).toHaveCount(0);
    // הקובץ שכבר נפתח נשאר בעריכה
    await expect(page.getByTestId('visual-audio-editor')).toBeVisible();
  });
});
