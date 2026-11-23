import { mkdirSync, writeFileSync } from 'node:fs';
import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';
import type { Page } from '@playwright/test';

/**
 * האם הקבצים שיוצאים בסוף באמת נכונים.
 *
 * שאר הבדיקות בודקות שהממשק אומר את הדבר הנכון. כאן מורידים את
 * הקבצים עצמם ומודדים מה יש בתוכם — זה מה שמוכיח שהחיתוך נפל
 * במקום הנכון ושהחיבור תפר כמו שצריך.
 *
 * האודיו בנוי מחמישה צלילים שאפשר לזהות כל אחד בנפרד, עם שקט
 * ביניהם כדי שההצמדה לשקט תעבוד כמו במציאות:
 *
 *   מילה    זמן            תדר
 *   אחת     0.00–0.90       300 הרץ
 *   שתיים   1.00–1.90       600 הרץ
 *   שלוש    2.00–2.90      1200 הרץ
 *   ארבע    3.00–3.90      2400 הרץ
 *   חמש     4.00–4.90      3600 הרץ
 *
 * כל בדיקה מורידה את הקבצים לתיקייה, והניתוח נעשה אחר כך בכלי
 * נפרד שמודד אורך ותדרים. כך אי אפשר "לעבור" בלי שהאודיו נכון.
 */

const SAMPLE_RATE = 16000;
const TONES = [300, 600, 1200, 2400, 3600];
const OUT_DIR = process.env.CUT_AUDIO_DIR || 'test-results/audio-cases';

function fiveTonesWav(): Buffer {
  const numSamples = Math.round(5 * SAMPLE_RATE);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);

  TONES.forEach((hz, index) => {
    const from = Math.round((index * 1.0) * SAMPLE_RATE);
    const to = Math.round((index * 1.0 + 0.9) * SAMPLE_RATE);
    for (let i = from; i < to; i += 1) {
      buf.writeInt16LE(Math.round(12000 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)), 44 + i * 2);
    }
  });
  return buf;
}

const WORDS = [
  { word: 'אחת', start: 0.05, end: 0.85, probability: 0.97 },
  { word: 'שתיים', start: 1.05, end: 1.85, probability: 0.96 },
  { word: 'שלוש', start: 2.05, end: 2.85, probability: 0.98 },
  { word: 'ארבע', start: 3.05, end: 3.85, probability: 0.95 },
  { word: 'חמש', start: 4.05, end: 4.85, probability: 0.99 },
];

test.describe.configure({ mode: 'serial' });

/** מעלה את הקובץ, מתמלל, ומחזיר דף מוכן לסימון. */
async function prepare(page: Page) {
  await mockSupabase(page, { authenticated: true });
  await injectAuthSession(page);
  await mockLocalServer(page, {
    connected: true,
    durationSec: 5,
    text: 'אחת שתיים שלוש ארבע חמש',
    wordTimings: WORDS,
  });

  await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /חיתוך/ }).click();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'חמישה-צלילים.wav',
    mimeType: 'audio/wav',
    buffer: fiveTonesWav(),
  });
  await expect(page.getByTestId('visual-audio-editor')).toBeVisible({ timeout: 20000 });

  const closePanel = page.getByRole('dialog', { name: 'קבצים שהושלמו' }).getByRole('button', { name: 'סגור' });
  if (await closePanel.count()) await closePanel.first().click().catch(() => undefined);

  await page.getByTestId('transcribe-for-cut').click();
  await expect(page.getByTestId('transcript-cut-area')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('snap-toggle')).toBeEnabled({ timeout: 15000 });
}

/** מסמן מילה אחת ולוחץ מחק או ייצא. */
async function act(page: Page, wordIndex: number, what: 'delete' | 'export') {
  await page.locator(`[data-word-index="${wordIndex}"]`).click();
  await page.getByTestId(what === 'delete' ? 'delete-selection' : 'export-selection').click();
}

/** חותך, ומוריד כל קטע שנוצר לתיקייה בשם הבדיקה. */
async function cutAndSave(page: Page, caseName: string, expectedFiles: number) {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.getByRole('button', { name: /חתוך/ }).first().click();

  const rows = page.getByTestId('cut-result-row');
  await expect(rows).toHaveCount(expectedFiles, { timeout: 90000 });

  for (let i = 0; i < expectedFiles; i += 1) {
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await rows.nth(i).getByTestId('download-result').click();
    const download = await downloadPromise;
    await download.saveAs(`${OUT_DIR}/${caseName}-${i + 1}.wav`);
  }
  // eslint-disable-next-line no-console
  console.log(`[קבצים] ${caseName}: ${expectedFiles}`);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/מקור.wav`, fiveTonesWav());
});

test('מחיקה של קטע אחד', async ({ page }) => {
  await prepare(page);
  await act(page, 1, 'delete');               // מוחק את "שתיים" (600 הרץ)
  await expect(page.getByText('1 אזורים מסומנים')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('קובץ אחד מחובר')).toBeVisible();
  await cutAndSave(page, 'מחיקה-אחד', 1);
});

test('מחיקה של שני קטעים בבחירה מרובה', async ({ page }) => {
  await prepare(page);
  await act(page, 1, 'delete');               // "שתיים" (600)
  await act(page, 3, 'delete');               // "ארבע" (2400)
  await expect(page.getByText('2 אזורים מסומנים')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('קובץ אחד מחובר')).toBeVisible();
  await cutAndSave(page, 'מחיקה-שניים', 1);
});

test('מחיקה של שני קטעים, בלי לחבר — כל חלק בנפרד', async ({ page }) => {
  await prepare(page);
  await act(page, 1, 'delete');
  await act(page, 3, 'delete');
  await page.getByTestId('join-output-toggle').click();   // מכבה את החיבור
  await expect(page.getByText('3 קבצים נפרדים')).toBeVisible({ timeout: 10000 });
  await cutAndSave(page, 'מחיקה-נפרד', 3);
});

test('ייצוא של קטע אחד', async ({ page }) => {
  await prepare(page);
  await act(page, 2, 'export');               // מייצא את "שלוש" (1200 הרץ)
  await expect(page.getByText('1 אזורים מסומנים')).toBeVisible({ timeout: 10000 });
  await cutAndSave(page, 'ייצוא-אחד', 1);
});

test('ייצוא של שני קטעים בבחירה מרובה — קבצים נפרדים', async ({ page }) => {
  await prepare(page);
  await act(page, 1, 'export');               // "שתיים" (600)
  await act(page, 3, 'export');               // "ארבע" (2400)
  await expect(page.getByText('2 אזורים מסומנים')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('2 קבצים נפרדים')).toBeVisible();
  await cutAndSave(page, 'ייצוא-שניים-נפרד', 2);
});

test('ייצוא של שני קטעים, מחוברים לקובץ אחד', async ({ page }) => {
  await prepare(page);
  await act(page, 1, 'export');
  await act(page, 3, 'export');
  await page.getByTestId('join-output-toggle').click();   // מדליק את החיבור
  await expect(page.getByText('קובץ אחד מחובר')).toBeVisible({ timeout: 10000 });
  await cutAndSave(page, 'ייצוא-שניים-מחובר', 1);
});
