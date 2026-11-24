import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

const SAMPLE_RATE = 16000;

/** קובץ צליל תקין, שהמערכת מצליחה לקרוא ממנו אורך. */
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

/**
 * האם הסימונים אומרים את האמת, ואפשר לבחור מנוע.
 *
 * סימון שרת שנראה אותו דבר מחובר ומנותק גרוע מאין סימון: הוא נותן
 * ביטחון שאין לו כיסוי. לכן הבדיקה מודדת את הצבע בפועל, ולא רק את
 * המילים.
 */

test.describe.configure({ mode: 'serial' });

test.describe('סימון השרת ובחירת המנוע', () => {
  test('כששרת התמלול מחובר — הסימון ירוק ואומר שהוא מחובר', async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });

    const badge = page.getByTestId('server-badge');
    await expect(badge).toBeVisible({ timeout: 25000 });
    await expect(badge).toHaveAttribute('data-online', 'true');
    await expect(badge).toContainText('שרת מחובר');

    const color = await badge.evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    // ירוק: הערוץ הירוק שולט
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  test('כששרת התמלול מנותק — הסימון אדום ואומר שהוא מנותק', async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: false });
    await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });

    const badge = page.getByTestId('server-badge');
    await expect(badge).toBeVisible({ timeout: 25000 });
    await expect(badge).toHaveAttribute('data-online', 'false');
    await expect(badge).toContainText('שרת מנותק');

    const color = await badge.evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    // אדום: הערוץ האדום שולט
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  test('אפשר לבחור באיזה מנוע לתמלל, והבחירה נשמרת', async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /חיתוך/ }).click();
    await expect(page.getByTestId('cut-drop-zone')).toBeVisible({ timeout: 20000 });

    await page.getByTestId('cut-file-input').setInputFiles({
      name: 'שיעור.wav',
      mimeType: 'audio/wav',
      buffer: toneWav(3, 440),
    });
    await expect(page.getByTestId('visual-audio-editor')).toBeVisible({ timeout: 25000 });

    // בוחר המנוע מופיע ליד ההצעה לתמלל
    const picker = page.getByTestId('cut-model-select');
    await expect(picker).toBeVisible({ timeout: 25000 });
    await expect(picker).toContainText('Ivrit.ai Turbo V3');

    await picker.click();
    // כל המנועים מוצעים, עם הסבר בעברית
    await expect(page.getByRole('option', { name: /Ivrit\.ai Large V3/ })).toBeVisible();
    await expect(page.getByText('דיוק מרבי, איטי יותר — עברית')).toBeVisible();
    await page.getByRole('option', { name: /Ivrit\.ai Large V3/ }).click();

    await expect(picker).toContainText('Ivrit.ai Large V3');

    // הבחירה נשמרת, ומשותפת לשאר המסכים
    const saved = await page.evaluate(() => localStorage.getItem('preferred_local_model'));
    expect(saved).toBe('ivrit-ai/whisper-large-v3-ct2');

    // וגם אחרי רענון
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /חיתוך/ }).click();
    await expect(page.getByTestId('cut-model-select')).toContainText('Ivrit.ai Large V3', { timeout: 25000 });
  });
});
