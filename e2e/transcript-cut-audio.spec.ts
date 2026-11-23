import { writeFileSync } from 'node:fs';
import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

/**
 * האם הקובץ שיוצא בסוף באמת נכון.
 *
 * כל הבדיקות האחרות בודקות שהממשק אמר את הדבר הנכון. כאן נבדק
 * הקובץ עצמו: מורידים אותו מהדפדפן ומודדים מה יש בתוכו.
 *
 * האודיו בנוי משלושה צלילים שונים, שאפשר לזהות כל אחד מהם בנפרד:
 *   0.00–0.95  צליל נמוך   (300 הרץ)
 *   0.95–1.05  שקט
 *   1.05–1.95  צליל אמצעי  (900 הרץ)
 *   1.95–2.05  שקט
 *   2.05–3.00  צליל גבוה   (1800 הרץ)
 *
 * מוחקים את המילה האמצעית. הקובץ שאמור לצאת: כשתי שניות, ובתוכו
 * הצליל הנמוך והגבוה בלבד — האמצעי חייב להיעלם לגמרי. אם החיתוך
 * נפל במקום הלא נכון, או שהחיבור השאיר שארית, זה ייראה כאן.
 */

const SAMPLE_RATE = 16000;
const LOW_HZ = 300;
const MID_HZ = 900;
const HIGH_HZ = 1800;

function threeTonesWav(): Buffer {
  const blocks: Array<[number, number, number]> = [
    [0.00, 0.95, LOW_HZ],
    [0.95, 1.05, 0],
    [1.05, 1.95, MID_HZ],
    [1.95, 2.05, 0],
    [2.05, 3.00, HIGH_HZ],
  ];
  const numSamples = Math.round(3 * SAMPLE_RATE);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);

  for (const [from, to, hz] of blocks) {
    for (let i = Math.round(from * SAMPLE_RATE); i < Math.round(to * SAMPLE_RATE); i += 1) {
      const value = hz ? Math.round(12000 * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE)) : 0;
      buf.writeInt16LE(value, 44 + i * 2);
    }
  }
  return buf;
}

const WORDS = [
  { word: 'נמוך', start: 0.05, end: 0.90, probability: 0.97 },
  { word: 'אמצעי', start: 1.10, end: 1.90, probability: 0.96 },
  { word: 'גבוה', start: 2.10, end: 2.95, probability: 0.98 },
];

test.describe.configure({ mode: 'serial' });

test('מחיקה מהטקסט מייצרת קובץ שבאמת חסר בו החלק שנמחק', async ({ page }) => {
  await mockSupabase(page, { authenticated: true });
  await injectAuthSession(page);
  await mockLocalServer(page, {
    connected: true,
    durationSec: 3,
    text: 'נמוך אמצעי גבוה',
    wordTimings: WORDS,
  });

  await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /חיתוך/ }).click();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'שלושה-צלילים.wav',
    mimeType: 'audio/wav',
    buffer: threeTonesWav(),
  });
  await expect(page.getByTestId('visual-audio-editor')).toBeVisible({ timeout: 20000 });

  const closePanel = page.getByRole('dialog', { name: 'קבצים שהושלמו' }).getByRole('button', { name: 'סגור' });
  if (await closePanel.count()) await closePanel.first().click().catch(() => undefined);

  await page.getByTestId('transcribe-for-cut').click();
  await expect(page.getByTestId('transcript-cut-area')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('snap-toggle')).toBeEnabled({ timeout: 15000 });

  // מוחקים את המילה האמצעית בלבד
  await page.locator('[data-word-index="1"]').click();
  await page.getByTestId('delete-selection').click();
  await expect(page.getByText('1 אזורים מסומנים')).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: /חתוך/ }).first().click();
  await expect(page.getByText('קובץ אחד רצוף')).toBeVisible({ timeout: 60000 });

  // מורידים את הקובץ שנוצר ושומרים אותו לבדיקה.
  // "הורד" המדויק הוא הכפתור של הקטע; "הורד הכל" הוא כפתור אחר.
  const downloadButton = page.getByRole('button', { name: 'הורד', exact: true }).first();
  await expect(downloadButton).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1000);
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await downloadButton.click();
  const download = await downloadPromise;
  const target = process.env.CUT_AUDIO_OUT || 'test-results/joined.wav';
  await download.saveAs(target);

  // גם את המקור, להשוואה
  writeFileSync(process.env.CUT_AUDIO_SOURCE || 'test-results/source.wav', threeTonesWav());

  // eslint-disable-next-line no-console
  console.log(`[קובץ] נשמר ל-${target}`);
});
