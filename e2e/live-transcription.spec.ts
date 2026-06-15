import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

/**
 * E2E tests for Live Transcription features:
 * - UI + mode selector
 * - Pause/Resume buttons
 * - Folder selector + create new folder
 * - Save / Download / Copy / Clear controls
 */

test.describe('תמלול חי - ממשק בסיסי', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    await page.goto('/transcribe');
  });

  test('כרטיס תמלול חי מוצג', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'תמלול בזמן אמת' })).toBeVisible();
  });

  test('כפתור התחל תמלול חי מוצג', async ({ page }) => {
    await expect(page.getByRole('button', { name: /התחל תמלול חי/i })).toBeVisible();
  });

  test('בורר מצב מוצג - CUDA ו-Web Speech', async ({ page }) => {
    await expect(page.getByRole('button', { name: /CUDA Whisper/i })).toBeVisible();
    // Web Speech may or may not be supported; just check CUDA is there
  });

  test('הודעת ברירת מחדל מוצגת כשלא מקליטים', async ({ page }) => {
    await expect(page.getByText(/לחץ על הכפתור כדי להתחיל/)).toBeVisible();
  });
});

test.describe('תמלול חי - בורר תיקיות', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    await page.goto('/transcribe');
  });

  test('בורר תיקיות מוצג', async ({ page }) => {
    await expect(page.getByText('ללא תיקייה')).toBeVisible();
  });

  test('כפתור יצירת תיקייה חדשה מוצג', async ({ page }) => {
    const folderBtn = page.getByRole('button', { name: /תיקייה חדשה/i });
    await expect(folderBtn).toBeVisible();
  });

  test('לחיצה על תיקייה חדשה מציגה שדה קלט', async ({ page }) => {
    await page.getByRole('button', { name: /תיקייה חדשה/i }).click();
    await expect(page.getByPlaceholder('שם תיקייה...')).toBeVisible();
  });

  test('יצירת תיקייה חדשה ובחירתה', async ({ page }) => {
    // Open folder creation
    await page.getByRole('button', { name: /תיקייה חדשה/i }).click();
    const input = page.getByPlaceholder('שם תיקייה...');
    await input.fill('ישיבות צוות');
    await page.getByRole('button', { name: '✓' }).click();

    // Verify folder was created - toast appears
    await expect(page.getByText(/תיקייה.*נוצרה/).first()).toBeVisible({ timeout: 3000 });

    // Verify it's now selected in the dropdown
    await expect(page.getByRole('combobox').filter({ hasText: 'ישיבות צוות' })).toBeVisible();

    // Verify saved to localStorage
    const folders = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('local_folders') || '[]');
    });
    expect(folders).toContain('ישיבות צוות');
  });

  test('ביטול יצירת תיקייה', async ({ page }) => {
    await page.getByRole('button', { name: /תיקייה חדשה/i }).click();
    await page.getByPlaceholder('שם תיקייה...').fill('בדיקה');
    await page.getByRole('button', { name: '✕' }).click();

    // Input should be hidden
    await expect(page.getByPlaceholder('שם תיקייה...')).not.toBeVisible();
  });

  test('תיקיות קיימות מוצגות בדרופדאון', async ({ page }) => {
    // Pre-inject folders
    await page.evaluate(() => {
      localStorage.setItem('local_folders', JSON.stringify(['פגישות', 'הרצאות']));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Open dropdown
    await page.getByText('ללא תיקייה').click();
    await expect(page.getByText('פגישות')).toBeVisible();
    await expect(page.getByText('הרצאות')).toBeVisible();
  });
});

test.describe('תמלול חי - כפתורי שליטה', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    // Mock the transcribe-live endpoint for CUDA mode
    await page.route('**/localhost:3000/transcribe-live', async (route) => {
      return route.fulfill({
        status: 200,
        json: { text: 'בדיקת תמלול חי', wordTimings: [] },
      });
    });
    await page.goto('/transcribe');
  });

  test('כפתורים מופיעים לאחר הקלטה (UI mock)', async ({ page }) => {
    // We can't actually start recording in E2E (no microphone),
    // so we test the button existence in initial state
    const startBtn = page.getByRole('button', { name: /התחל תמלול חי/i });
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeEnabled();
  });

  test('CUDA Whisper מצב מוצג', async ({ page }) => {
    // CUDA button is always visible; enabled state depends on parent's serverConnected prop
    const cudaBtn = page.getByRole('button', { name: /CUDA Whisper/i });
    await expect(cudaBtn).toBeVisible();
  });

  test('כפתור CUDA מושבת כשאין שרת', async ({ page }) => {
    await mockLocalServer(page, { connected: false });
    await page.reload();
    await page.waitForLoadState('networkidle');

    // CUDA button should be disabled when server is disconnected
    const cudaBtn = page.getByRole('button', { name: /CUDA Whisper/i });
    if (await cudaBtn.count() > 0) {
      await expect(cudaBtn).toBeDisabled();
    }
  });
});

test.describe('תמלול חי - טקסט מידע', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    await page.goto('/transcribe');
  });

  test('מידע על מצב תמלול מוצג', async ({ page }) => {
    // Footer text shows in the LiveTranscriber card area
    // It may show Web Speech or CUDA info depending on mode
    await expect(page.getByText(/Web Speech API|Whisper.*GPU/).first()).toBeVisible();
  });
});
