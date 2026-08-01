import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

test.describe('מעבדת ניקוי קול — AudioCleanLab', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await mockLocalServer(page);
    await injectAuthSession(page);
  });

  test('דף ניקוי קול נטען ומציג כותרת ו-3 טאבים', async ({ page }) => {
    await page.goto('/audio-clean');
    await expect(page).toHaveURL(/\/audio-clean/, { timeout: 30000 });

    // Page title
    await expect(page.getByText('מעבדת ניקוי קול').first()).toBeVisible({ timeout: 15000 });

    const lab = page.getByTestId('audio-clean-lab');
    await expect(lab).toHaveAttribute('dir', 'rtl');
    expect(await lab.evaluate(element => getComputedStyle(element).textAlign)).toBe('right');

    // 3 tabs
    await expect(page.getByRole('tab', { name: /תהליך עיבוד/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /השוואת מקור ופלט/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /מידע/i })).toBeVisible();
  });

  test('אזור העלאת קובץ מוצג ב-Pipeline', async ({ page }) => {
    await page.goto('/audio-clean');
    await expect(page.getByText('גרור קובץ אודיו או לחץ לבחירה')).toBeVisible({ timeout: 15000 });
  });

  test('טאב מידע מציג ארכיטקטורת Pipeline', async ({ page }) => {
    await page.goto('/audio-clean');
    await page.getByRole('tab', { name: /מידע/i }).click();
    await expect(page.getByText('מבנה תהליך העיבוד')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('ניקוי רעש — RNNoise')).toBeVisible();
    await expect(page.getByText('אקולייזר ומסננים')).toBeVisible();
    await expect(page.getByText('איזון עוצמה').first()).toBeVisible();
    await expect(page.getByText('שיפור בבינה מלאכותית (שרת)').first()).toBeVisible();

    const infoTitle = page.getByTestId('audio-info-title');
    const step = page.getByTestId('audio-info-step-1');
    const stepNumber = page.getByTestId('audio-info-step-number-1');
    const stepContent = page.getByTestId('audio-info-step-content-1');
    expect(await infoTitle.evaluate(element => getComputedStyle(element).direction)).toBe('rtl');
    expect(await infoTitle.evaluate(element => getComputedStyle(element).textAlign)).toBe('right');
    expect(await step.evaluate(element => getComputedStyle(element).direction)).toBe('rtl');
    const numberX = await stepNumber.evaluate(element => element.getBoundingClientRect().x);
    const contentX = await stepContent.evaluate(element => element.getBoundingClientRect().x);
    expect(numberX).toBeGreaterThan(contentX);
  });

  test('טאב השוואה A/B מציג אזור העלאה', async ({ page }) => {
    await page.goto('/audio-clean');
    await page.getByRole('tab', { name: /השוואת מקור ופלט/i }).click();
    await expect(page.getByText('גרור קובץ להשוואה משולשת')).toBeVisible({ timeout: 10000 });
  });

  test('Pipeline מציג הגדרות אחרי העלאת קובץ', async ({ page }) => {
    await page.goto('/audio-clean');
    await expect(page.getByText('גרור קובץ אודיו או לחץ לבחירה')).toBeVisible({ timeout: 15000 });

    // Upload a test WAV file
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'test-audio.wav',
      mimeType: 'audio/wav',
      buffer: createTestWav(),
    });

    // Pipeline config should appear
    await expect(page.getByText('הגדרות תהליך העיבוד')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('ניקוי רעש (RNNoise)')).toBeVisible();
    await expect(page.getByText('אקולייזר ומסננים')).toBeVisible();
    await expect(page.getByText('הפעל תהליך עיבוד')).toBeVisible();
    await expect(page.getByText('זרימת תהליך העיבוד')).toBeVisible();
  });

  test('Pipeline flow visualization מוצג', async ({ page }) => {
    await page.goto('/audio-clean');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'test.wav',
      mimeType: 'audio/wav',
      buffer: createTestWav(),
    });

    // Flow nodes should be visible
    await expect(page.getByText('קובץ מקור')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('RNNoise', { exact: true })).toBeVisible();
    await expect(page.getByText('פלט נקי')).toBeVisible();
  });

  test('Pipeline מציג אחוזים בסרגל התקדמות', async ({ page }) => {
    await page.goto('/audio-clean');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'test.wav',
      mimeType: 'audio/wav',
      buffer: createTestWav(),
    });

    await expect(page.getByText('הפעל תהליך עיבוד')).toBeVisible({ timeout: 10000 });

    // Click run — the progress should show a percentage
    await page.getByText('הפעל תהליך עיבוד').click();

    // Wait for percentage to appear (e.g. "5%" or "15%" etc.)
    await expect(page.getByText(/%/).first()).toBeVisible({ timeout: 15000 });
  });

  test('Pipeline אמיתי מפיק תוצאה עקבית בשתי הרצות על אותו קובץ', async ({ page }) => {
    await page.goto('/audio-clean');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'speech-with-noise.wav',
      mimeType: 'audio/wav',
      buffer: createNoisySpeechWav(),
    });

    const runAndReadQuality = async () => {
      await page.getByText('הפעל תהליך עיבוד').click();
      const report = page.getByTestId('audio-quality-report');
      await expect(report).toBeVisible({ timeout: 60000 });
      return {
        verdict: (await page.getByTestId('audio-quality-verdict').innerText()).trim(),
        score: (await page.getByTestId('audio-quality-score').innerText()).trim(),
        snrDelta: (await page.getByTestId('audio-quality-snr-delta').innerText()).trim(),
        noiseFloorDelta: (await page.getByTestId('audio-quality-noise-floor-delta').innerText()).trim(),
        contentSimilarity: (await page.getByTestId('audio-quality-content-similarity').innerText()).trim(),
        durationDrift: (await page.getByTestId('audio-quality-duration-drift').innerText()).trim(),
      };
    };

    const firstRun = await runAndReadQuality();
    const secondRun = await runAndReadQuality();

    expect(secondRun).toEqual(firstRun);
    expect(firstRun.verdict).not.toContain('רגרסיה');

    const report = page.getByTestId('audio-quality-report');
    await expect(report.getByText('שער איכות אובייקטיבי')).toBeVisible();
    await expect(report.getByText(/שיפור מדיד|יציב|לא חד-משמעי/)).toBeVisible();
    await expect(report.getByText('דמיון תוכן')).toBeVisible();
    await expect(report.getByText('סטיית משך')).toBeVisible();
  });

  test('כפתור המשך מוצג אחרי שגיאה ב-AI', async ({ page }) => {
    // Mock the AI enhance endpoint to return an error
    await page.route('**/enhance-audio', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Test AI error' }) })
    );

    await page.goto('/audio-clean');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'test.wav',
      mimeType: 'audio/wav',
      buffer: createTestWav(),
    });

    await expect(page.getByText('הפעל תהליך עיבוד')).toBeVisible({ timeout: 10000 });

    // Turn off RNNoise and EQ, turn on AI using nth switch indexes
    // Switch order: 0=RNNoise(on), 1=EQ(on), 2=boostPresence(on, inside EQ), 3=Normalize(off), 4=AI(off)
    const switches = page.locator('button[role="switch"]');
    await switches.nth(0).click(); // RNNoise OFF
    // After turning EQ off, boostPresence disappears, so indexes shift
    await switches.nth(1).click(); // EQ OFF
    // Now switches: 0=RNNoise(off), 1=EQ(off), 2=Normalize(off), 3=AI(off)
    await switches.nth(3).click(); // AI ON

    // Verify AI is enabled — preset selector should appear
    await expect(page.getByText('Demucs / DeepFilter / MetricGAN')).toBeVisible({ timeout: 5000 });

    // Run pipeline — AI stage should fail
    await page.getByText('הפעל תהליך עיבוד').click();

    // Should show error message
    await expect(page.locator('.text-red-500').first()).toBeVisible({ timeout: 30000 });

    // Should show resume button instead of "הפעל Pipeline"
    await expect(page.getByText('המשך מאיפה שנתקע')).toBeVisible({ timeout: 5000 });
  });

  test('ניווט מ-sidebar פועל', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\//, { timeout: 30000 });

    // Find and click the nav item
    const navLink = page.getByRole('button', { name: 'ניקוי קול' });
    await expect(navLink).toBeVisible({ timeout: 5000 });
    await navLink.evaluate((el: HTMLElement) => el.click());
    await expect(page).toHaveURL(/\/audio-clean/, { timeout: 15000 });
    await expect(page.getByText('מעבדת ניקוי קול').first()).toBeVisible({ timeout: 15000 });
  });
});

/**
 * Create a minimal valid WAV file (16-bit PCM, 48kHz, mono, ~0.1 sec silence)
 */
function createTestWav(): Buffer {
  const sampleRate = 48000;
  const numSamples = Math.floor(sampleRate * 0.1); // 0.1 sec
  const dataSize = numSamples * 2; // 16-bit = 2 bytes
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // fmt sub-chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);     // SubChunk1Size
  buffer.writeUInt16LE(1, 20);      // PCM
  buffer.writeUInt16LE(1, 22);      // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  buffer.writeUInt16LE(2, 32);      // BlockAlign
  buffer.writeUInt16LE(16, 34);     // BitsPerSample

  // data sub-chunk (silence — all zeros)
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // samples are already 0 (silence)

  return buffer;
}

function createNoisySpeechWav(): Buffer {
  const sampleRate = 48000;
  const durationSec = 1;
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  let seed = 123456789;
  for (let index = 0; index < numSamples; index += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    const noise = (seed / 0xffffffff * 2 - 1) * 0.07;
    const time = index / sampleRate;
    const speech = (Math.floor(time * 5) % 2 === 0)
      ? 0.35 * Math.sin(2 * Math.PI * 220 * time)
      : 0;
    const sample = Math.max(-1, Math.min(1, speech + noise));
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return buffer;
}
