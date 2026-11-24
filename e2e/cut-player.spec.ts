import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';
import type { Page } from '@playwright/test';

/**
 * הנגן של קטעי החיתוך: נגן מלא בשורה, נגן צף למעבר בין הקטעים,
 * ושרק אחד מתנגן בכל רגע.
 *
 * הדבר האחרון אפשר לבדוק רק בדפדפן אמיתי: צריך שני רכיבי אודיו
 * חיים כדי לראות שהפעלת אחד באמת עוצרת את השני.
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

/** מעלה קובץ, חותך אותו לשלושה קטעים, ומחזיר דף עם תוצאות. */
async function cutIntoThree(page: Page) {
  await mockSupabase(page, { authenticated: true });
  await injectAuthSession(page);
  await mockLocalServer(page, { connected: true, durationSec: 9 });

  await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /חיתוך/ }).click();
  await expect(page.getByTestId('cut-drop-zone')).toBeVisible({ timeout: 20000 });

  await page.getByTestId('cut-file-input').setInputFiles({
    name: 'שיעור ארוך.wav',
    mimeType: 'audio/wav',
    buffer: toneWav(9, 440),
  });
  await expect(page.getByTestId('visual-audio-editor')).toBeVisible({ timeout: 25000 });
  await closeCompletedPanel(page);

  await page.getByRole('button', { name: '3 חלקים' }).click();
  await page.getByRole('button', { name: /^חתוך/ }).first().click();

  await expect(page.getByTestId('cut-result-row')).toHaveCount(3, { timeout: 90000 });
  await closeCompletedPanel(page);
}

test.describe.configure({ mode: 'serial' });

test.describe('נגן קטעי החיתוך', () => {
  test('בשורת קטע נפתח נגן מלא, עם קפיצה, מהירות ועוצמה', async ({ page }) => {
    await cutIntoThree(page);

    const rows = page.getByTestId('cut-result-row');
    await rows.first().getByTestId('open-player').click();

    const player = page.getByTestId('row-player');
    await expect(player).toBeVisible();
    // כל האפשרויות, לא רק נגן/עצור
    await expect(player.getByTestId('row-player-toggle')).toBeVisible();
    await expect(player.getByTestId('row-player-back')).toBeVisible();
    await expect(player.getByTestId('row-player-forward')).toBeVisible();
    await expect(player.getByTestId('row-player-seek')).toBeVisible();
    await expect(player.getByTestId('row-player-speed')).toBeVisible();
    await expect(player.getByTestId('row-player-volume')).toBeVisible();
    await expect(player.getByTestId('row-player-mute')).toBeVisible();
    // ושעון התחלה וסוף
    await expect(player.getByTestId('row-player-current')).toContainText('0:00');
  });

  test('אפשר לשנות את מהירות הניגון', async ({ page }) => {
    await cutIntoThree(page);
    await page.getByTestId('cut-result-row').first().getByTestId('open-player').click();

    const speed = page.getByTestId('row-player-speed');
    await expect(speed).toContainText('1×');
    await speed.click();
    await page.getByRole('menuitem', { name: /1\.5×/ }).click();
    await expect(speed).toContainText('1.5×');
  });

  test('הנגן הצף נפתח ומכיל את כל הקטעים', async ({ page }) => {
    await cutIntoThree(page);

    await page.getByTestId('cut-result-row').nth(1).getByTestId('open-floating-player').click();

    const floating = page.getByTestId('floating-cut-player');
    await expect(floating).toBeVisible();
    await expect(floating).toContainText('2 מתוך 3');
    // רשימת כל הקטעים, למעבר מהיר
    await expect(floating.getByTestId('cut-player-track')).toHaveCount(3);
    await expect(floating.getByTestId('cut-player-track').nth(1)).toHaveAttribute('data-current', 'true');
  });

  test('בנגן הצף אפשר לעבור לקטע הבא ולקודם', async ({ page }) => {
    await cutIntoThree(page);
    await page.getByTestId('cut-result-row').first().getByTestId('open-floating-player').click();

    const floating = page.getByTestId('floating-cut-player');
    await expect(floating).toContainText('1 מתוך 3');

    await floating.getByTestId('cut-player-next').click();
    await expect(floating).toContainText('2 מתוך 3');

    await floating.getByTestId('cut-player-prev').click();
    await expect(floating).toContainText('1 מתוך 3');
  });

  test('לחיצה על קטע ברשימה עוברת אליו', async ({ page }) => {
    await cutIntoThree(page);
    await page.getByTestId('cut-result-row').first().getByTestId('open-floating-player').click();

    const floating = page.getByTestId('floating-cut-player');
    await floating.getByTestId('cut-player-track').nth(2).click();

    await expect(floating).toContainText('3 מתוך 3');
    await expect(floating.getByTestId('cut-player-track').nth(2)).toHaveAttribute('data-current', 'true');
  });

  /*
    זה מה שביקש המשתמש במפורש: בלי זה אפשר להפעיל כמה נגנים יחד,
    ושומעים שני קטעים מתנגנים זה על זה.
  */
  test('הפעלת נגן אחד עוצרת את הנגן האחר', async ({ page }) => {
    await cutIntoThree(page);

    const rows = page.getByTestId('cut-result-row');
    await rows.nth(0).getByTestId('open-player').click();
    await rows.nth(1).getByTestId('open-player').click();

    const players = page.getByTestId('row-player');
    await expect(players).toHaveCount(2);

    // מפעילים את הראשון
    await players.nth(0).getByTestId('row-player-toggle').click();
    await expect(players.nth(0)).toHaveAttribute('data-playing', 'true', { timeout: 10000 });

    // ואז את השני — הראשון חייב להיעצר
    await players.nth(1).getByTestId('row-player-toggle').click();
    await expect(players.nth(1)).toHaveAttribute('data-playing', 'true', { timeout: 10000 });
    await expect(players.nth(0)).toHaveAttribute('data-playing', 'false', { timeout: 10000 });

    // ובפועל: רק רכיב אודיו אחד מתנגן בדף
    const playingCount = await page.evaluate(
      () => [...document.querySelectorAll('audio')].filter((a) => !a.paused).length,
    );
    expect(playingCount).toBeLessThanOrEqual(1);
  });

  test('הנגן הצף עוצר את נגן השורה', async ({ page }) => {
    await cutIntoThree(page);

    const rows = page.getByTestId('cut-result-row');
    await rows.nth(0).getByTestId('open-player').click();
    const rowPlayer = page.getByTestId('row-player').first();
    await rowPlayer.getByTestId('row-player-toggle').click();
    await expect(rowPlayer).toHaveAttribute('data-playing', 'true', { timeout: 10000 });

    await rows.nth(2).getByTestId('open-floating-player').click();
    const floating = page.getByTestId('floating-cut-player');
    await floating.getByTestId('cut-player-toggle').click();

    await expect(floating.getByTestId('cut-player')).toHaveAttribute('data-playing', 'true', { timeout: 10000 });
    await expect(rowPlayer).toHaveAttribute('data-playing', 'false', { timeout: 10000 });
  });

  test('סגירת הנגן הצף עוצרת את הניגון', async ({ page }) => {
    await cutIntoThree(page);
    await page.getByTestId('cut-result-row').first().getByTestId('open-floating-player').click();

    const floating = page.getByTestId('floating-cut-player');
    await floating.getByTestId('cut-player-toggle').click();
    await expect(floating.getByTestId('cut-player')).toHaveAttribute('data-playing', 'true', { timeout: 10000 });

    await floating.getByTestId('cut-player-close').click();
    await expect(page.getByTestId('floating-cut-player')).toHaveCount(0);

    const playingCount = await page.evaluate(
      () => [...document.querySelectorAll('audio')].filter((a) => !a.paused).length,
    );
    expect(playingCount).toBe(0);
  });
});
