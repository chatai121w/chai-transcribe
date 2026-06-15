import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

const RUN_REAL_FFMPEG_E2E = process.env.RUN_REAL_FFMPEG_E2E === '1';

test.describe.configure({ mode: 'serial' });

// ─── Generate a real WAV buffer (sine tone) that FFmpeg can actually convert ─
function createToneWavBuffer(durationSec = 2, freq = 440, sampleRate = 16000): Buffer {
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buf = Buffer.alloc(fileSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(fileSize - 8, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);   // PCM chunk size
  buf.writeUInt16LE(1, 20);    // PCM format
  buf.writeUInt16LE(1, 22);    // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);   // 16-bit
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(16000 * Math.sin(2 * Math.PI * freq * i / sampleRate));
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

test.describe('ממיר וידאו ואודיו', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
  });

  test('הדף נטען עם כותרת ואזור גרירה', async ({ page }) => {
    await expect(page.getByText(/ממיר וידאו ל-MP3|ממיר וידאו ואודיו/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('גרור קבצים לכאן או לחץ לבחירה')).toBeVisible();
    await expect(page.getByText(/מקבילים/)).toBeVisible();
  });

  test('תצוגת פורמטים נתמכים במצב ריק', async ({ page }) => {
    await expect(page.getByText('אין קבצים בתור')).toBeVisible({ timeout: 15000 });
    for (const fmt of ['MP4', 'MKV', 'AVI', 'MOV', 'WebM']) {
      await expect(page.getByText(fmt, { exact: true })).toBeVisible();
    }
  });

  test('העלאת קובץ מציגה כרטיס עבודה', async ({ page }) => {
    await expect(page.getByText(/ממיר וידאו ל-MP3|ממיר וידאו ואודיו/)).toBeVisible({ timeout: 15000 });

    // Create a minimal valid file and upload via the hidden input
    const fileInput = page.locator('input[type="file"]');
    const buffer = Buffer.alloc(1024, 0);
    await fileInput.setInputFiles({
      name: 'test-video.mp4',
      mimeType: 'video/mp4',
      buffer,
    });

    // A job card should appear with the file name
    await expect(page.getByText('test-video.mp4')).toBeVisible({ timeout: 10000 });
  });

  test('קובץ לא נתמך מציג הודעת שגיאה', async ({ page }) => {
    await expect(page.getByText(/ממיר וידאו ל-MP3|ממיר וידאו ואודיו/)).toBeVisible({ timeout: 15000 });

    const fileInput = page.locator('input[type="file"]');
    const buffer = Buffer.alloc(64, 0);
    await fileInput.setInputFiles({
      name: 'readme.txt',
      mimeType: 'text/plain',
      buffer,
    });

    // Should show toast about unsupported format
    await expect(page.getByText('פורמט לא נתמך')).toBeVisible({ timeout: 5000 });
    // No job card should appear
    await expect(page.getByText('אין קבצים בתור')).toBeVisible();
  });

  test('מספר קבצים מועלים במקביל', async ({ page }) => {
    await expect(page.getByText(/ממיר וידאו ל-MP3|ממיר וידאו ואודיו/)).toBeVisible({ timeout: 15000 });

    const fileInput = page.locator('input[type="file"]');
    const buffer = Buffer.alloc(512, 0);
    await fileInput.setInputFiles([
      { name: 'video1.mp4', mimeType: 'video/mp4', buffer },
      { name: 'video2.mkv', mimeType: 'video/x-matroska', buffer },
      { name: 'audio1.wav', mimeType: 'audio/wav', buffer },
    ]);

    // All three job cards should appear
    await expect(page.getByText('video1.mp4')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('video2.mkv')).toBeVisible();
    await expect(page.getByText('audio1.wav')).toBeVisible();

    // Stats line should show count
    await expect(page.getByText(/0\/3 הושלמו/)).toBeVisible();
  });

  test('כפתור ניווט בסרגל הצד', async ({ page }) => {
    // Verify we arrived at the page via sidebar
    await expect(page.getByText(/ממיר וידאו ל-MP3|ממיר וידאו ואודיו/)).toBeVisible({ timeout: 15000 });
    // Check the sidebar has the nav item (text or link)
    const sidebarItem = page.getByText('ממיר ל-MP3');
    await expect(sidebarItem.first()).toBeVisible({ timeout: 10000 });
  });

  test('תגית מנוע מוכן/טוען מוצגת', async ({ page }) => {
    // Should show either "מוכן" or "טוען מנוע" badge
    const readyOrLoading = page.getByText(/מוכן|טוען מנוע/);
    await expect(readyOrLoading.first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('ממיר וידאו - ללא חיבור', () => {
  test('הפניה לדף התחברות כשלא מחובר', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await mockSupabase(page, { authenticated: false });
    await mockLocalServer(page);
    await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });

    // Should redirect to auth page
    await page.waitForURL(/\/(auth|login)/, { timeout: 15000 });
  });
});

// ─── Real conversion test ────────────────────────────────────────────────────
test.describe('המרה אמיתית WAV → MP3', () => {
  test.skip(!RUN_REAL_FFMPEG_E2E, 'Requires real FFmpeg WASM runtime and network access for core assets');

  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('גרור קבצים לכאן או לחץ לבחירה')).toBeVisible({ timeout: 30000 });
  });

  test('המרת קובץ WAV אמיתי ל-MP3 מצליחה', async ({ page }) => {
    // Give this test extra time — FFmpeg WASM core download + conversion
    test.setTimeout(180_000);

    // Generate a real 2-second 440 Hz WAV file
    const wavBuffer = createToneWavBuffer(2, 440, 16000);

    // Upload it
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-tone.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    // Job card should appear
    await expect(page.getByText('test-tone.wav')).toBeVisible({ timeout: 10000 });

    // Wait for FFmpeg to load WASM core (can take ~30-60s on first load)
    // The status badge on the job card transitions: queued → loading → converting → done/error
    // We wait for the card to reach "done" status via data-status attribute
    const jobCard = page.locator('[data-testid="job-card"]').first();
    await expect(jobCard).toBeVisible({ timeout: 10000 });

    // Wait for conversion to complete (up to 120s for WASM download + transcode)
    await expect(jobCard).toHaveAttribute('data-status', 'done', { timeout: 120_000 });

    // Stats should show 1/1 completed
    await expect(page.getByText(/1\/1 הושלמו/)).toBeVisible({ timeout: 5000 });

    // Post-conversion dialog should appear
    await expect(page.getByText('ההמרה הושלמה!')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('test-tone.mp3')).toBeVisible();

    // Dialog should have both "transcribe" and "save" buttons
    await expect(page.getByText('תמלל את הקובץ')).toBeVisible();
    await expect(page.getByText('שמור קובץ')).toBeVisible();

    // Close the dialog by clicking save
    await page.getByText('שמור קובץ').click();
    await expect(page.getByText('הקובץ נשמר ✓').first()).toBeVisible({ timeout: 5000 });
  });

  test('המרת מספר קבצים במקביל מצליחה', async ({ page }) => {
    test.setTimeout(240_000);

    // Generate two different WAV files
    const wav1 = createToneWavBuffer(1, 440, 16000);
    const wav2 = createToneWavBuffer(1, 880, 16000);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles([
      { name: 'tone-440hz.wav', mimeType: 'audio/wav', buffer: wav1 },
      { name: 'tone-880hz.wav', mimeType: 'audio/wav', buffer: wav2 },
    ]);

    // Both cards should appear
    await expect(page.getByText('tone-440hz.wav')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('tone-880hz.wav')).toBeVisible();

    // Wait for both to finish
    const allCards = page.locator('[data-testid="job-card"]');
    await expect(allCards).toHaveCount(2, { timeout: 10000 });

    // Wait for all cards to reach "done"
    for (let i = 0; i < 2; i++) {
      await expect(allCards.nth(i)).toHaveAttribute('data-status', 'done', { timeout: 150_000 });
    }

    // Stats: 2/2
    await expect(page.getByText(/2\/2 הושלמו/)).toBeVisible({ timeout: 5000 });
  });

  test('קובץ פגום מציג שגיאה עם אפשרות לנסות שוב', async ({ page }) => {
    test.setTimeout(180_000);

    // Upload a corrupt file (random bytes, not a valid media file)
    const corrupt = Buffer.alloc(512, 0xDE);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'corrupt.mp4',
      mimeType: 'video/mp4',
      buffer: corrupt,
    });

    // Card appears
    await expect(page.getByText('corrupt.mp4')).toBeVisible({ timeout: 10000 });

    // Wait for error status
    const jobCard = page.locator('[data-testid="job-card"]').first();
    await expect(jobCard).toHaveAttribute('data-status', 'error', { timeout: 120_000 });

    // Error message should show
    await expect(page.getByText(/שגיאות/).first()).toBeVisible({ timeout: 5000 });
  });
});

// ─── OPUS conversion test ────────────────────────────────────────────────────
test.describe('המרה אמיתית WAV → OPUS', () => {
  test.skip(!RUN_REAL_FFMPEG_E2E, 'Requires real FFmpeg WASM runtime');

  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/video-to-mp3', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('גרור קבצים לכאן או לחץ לבחירה')).toBeVisible({ timeout: 30000 });
  });

  test('המרת קובץ WAV ל-OPUS מצליחה בדפדפן', async ({ page }) => {
    test.setTimeout(180_000);

    // Capture browser console for FFmpeg diagnostic output
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('FFmpeg') || text.includes('opus') || text.includes('OPUS') || text.includes('encoder') || text.includes('libopus') || text.includes('Error') || text.includes('error')) {
        consoleLogs.push(`[${msg.type()}] ${text}`);
      }
    });

    // 1. Switch output format to OPUS
    const opusButton = page.getByRole('button', { name: 'OPUS' });
    await opusButton.click();
    await expect(page.getByText(/נבחר:.*OPUS/)).toBeVisible({ timeout: 3000 });

    // 2. Generate and upload a real WAV file
    const wavBuffer = createToneWavBuffer(2, 440, 16000);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test-opus-tone.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    // 3. Job card should appear
    await expect(page.getByText('test-opus-tone.wav')).toBeVisible({ timeout: 10000 });

    // 4. Wait for conversion to finish (done OR error)
    const jobCard = page.locator('[data-testid="job-card"]').first();
    await expect(jobCard).toBeVisible({ timeout: 10000 });
    await expect(jobCard).toHaveAttribute('data-status', /done|error/, { timeout: 120_000 });

    // 5. Capture result
    const status = await jobCard.getAttribute('data-status');
    if (status === 'error') {
      // Collect visible error text from the job card
      const errorText = await jobCard.innerText();
      console.log('=== OPUS CONVERSION ERROR ===');
      console.log('Job card text:', errorText);
      console.log('Console logs:', consoleLogs.join('\n'));
      console.log('=== END ===');
    }

    // 6. Assert it succeeded
    await expect(jobCard).toHaveAttribute('data-status', 'done', { timeout: 5000 });
    await expect(page.getByText('test-opus-tone.opus')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/1\/1 הושלמו/)).toBeVisible({ timeout: 5000 });
  });
});
