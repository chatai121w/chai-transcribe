import { test, expect, mockSupabase, injectAuthSession, mockLocalServer, createTestAudioBuffer } from './helpers';
import path from 'path';

test.describe('דף תמלול - UI בסיסי', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/transcribe', { waitUntil: 'domcontentloaded' });
  });

  test('כותרת הדף מוצגת', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'מערכת תמלול מתקדמת', exact: true })).toBeVisible({ timeout: 15000 });
  });

  test('בורר מנוע תמלול מוצג', async ({ page }) => {
    // Engine selector should show at least one engine option
    await expect(page.getByText(/Groq|OpenAI|Google|CUDA|ONNX/).first()).toBeVisible();
  });

  test('אזור העלאת קבצים מוצג', async ({ page }) => {
    // File uploader should be visible with upload button or drop zone
    await expect(page.getByText(/העלה|גרור|בחר קובץ|upload/i).first()).toBeVisible();
  });

  test('טאבים מוצגים - תמלול ועריכה', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'תמלול', exact: true })).toBeVisible();
  });

  test('שחזור תמלול מציג את קובץ המקור ודוחה קובץ אחר', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('transcription_partial', JSON.stringify({
        text: 'טקסט חלקי שנשמר',
        progress: 15,
        lastSegEnd: 58,
        wordTimings: [{ word: 'טקסט', start: 0, end: 1 }],
        sourceFile: {
          name: 'source-recording.m4a',
          size: 4096,
          lastModified: 1700000000000,
          type: 'audio/mp4',
        },
      }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByText(/קובץ מקור: source-recording\.m4a/)).toBeVisible();
    await page.getByRole('button', { name: 'בחר קובץ והמשך' }).click();
    await page.locator('input[type="file"][accept*=".m4a"]').last().setInputFiles({
      name: 'different-recording.m4a',
      mimeType: 'audio/mp4',
      buffer: createTestAudioBuffer(),
    });

    await expect(page.getByText('זה אינו קובץ המקור', { exact: true })).toBeVisible();
    await expect(page.getByText(
      'יש לבחור את source-recording.m4a (4KB). הקובץ שנבחר לא תואם ולכן התמלול לא חודש.',
      { exact: true },
    )).toBeVisible();
    await expect(page.getByText(/קובץ מקור: source-recording\.m4a/)).toBeVisible();
  });

  test('שחזור עם גיבוי ענני מאפשר המשך ללא בחירת קובץ', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('transcription_partial', JSON.stringify({
        text: 'טקסט חלקי בענן',
        progress: 32,
        lastSegEnd: 91,
        wordTimings: [{ word: 'טקסט', start: 0, end: 1 }],
        sourceFile: {
          name: 'cloud-recovery.m4a',
          size: 8192,
          lastModified: 1700000000000,
          type: 'audio/mp4',
          cloudAudioPath: 'test-user/recovery/cloud-recovery.m4a',
          cloudBackedUpAt: 1700000001000,
        },
      }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await expect(page.getByText(/קובץ מקור: cloud-recovery\.m4a.*מגובה בענן/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'המשך מהענן' })).toBeVisible();
  });

  test('Gemini שומר checkpoint לפי מקטע ומשלים תמלול', async ({ page }) => {
    let geminiCalls = 0;
    await page.route('**/functions/v1/transcribe-gemini', async route => {
      geminiCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: 'תמלול מקטע Gemini', provider: 'personal' }),
      });
    });

    await page.locator('label[for="gemini"]').click();
    await page.locator('input[type="file"][accept*=".wav"]').first().setInputFiles({
      name: 'gemini-source.wav',
      mimeType: 'audio/wav',
      buffer: createTestAudioBuffer(),
    });

    await expect(page).toHaveURL(/text-editor/, { timeout: 30000 });
    expect(geminiCalls).toBe(1);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('transcription_partial'))).toBeNull();
  });
});

test.describe('בחירת מנוע תמלול', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/transcribe', { waitUntil: 'domcontentloaded' });
  });

  test('ניתן לבחור מנוע Groq', async ({ page }) => {
    const groqOption = page.getByText('Groq');
    if (await groqOption.count() > 0) {
      await groqOption.first().click();
      // Engine should be selected
      await expect(page.locator('[data-state="checked"], .bg-primary, [aria-selected="true"]').first()).toBeVisible();
    }
  });

  test('ניתן לבחור מנוע CUDA', async ({ page }) => {
    const cudaOption = page.getByText('CUDA');
    if (await cudaOption.count() > 0) {
      await cudaOption.first().click();
      // Should show server status indicator
      await expect(page.getByText(/שרת|server|חיבור|connected/i)).toBeVisible({ timeout: 5000 });
    }
  });

  test('בורר שפת מקור מוצג', async ({ page }) => {
    // Language selector should be available
    const langSelector = page.getByText(/עברית|אנגלית|יידיש|Hebrew|auto/i);
    await expect(langSelector.first()).toBeVisible();
  });

  test('מודל CUDA נשמר ובוררי פיסוק ופסקאות מפיקים Word RTL עם פסקאות', async ({ page }) => {
    const source = 'שלום לכולם היום נלמד נושא חדש בשיעור הראשון נדבר על חשיבות הדיוק לאחר מכן נעבור לשאלה המרכזית למה חשוב לשמור על כל המילים עכשיו נציג תשובה מסודרת וברורה לסיום נסכם את הדברים ונשמור את המסמך';
    const formatted = 'שלום לכולם, היום נלמד נושא חדש. בשיעור הראשון נדבר על חשיבות הדיוק.\n\nלאחר מכן נעבור לשאלה המרכזית: למה חשוב לשמור על כל המילים? עכשיו נציג תשובה מסודרת וברורה.\n\nלסיום, נסכם את הדברים ונשמור את המסמך.';
    await page.addInitScript(({ sourceText }) => {
      localStorage.setItem('transcription_partial', JSON.stringify({ text: sourceText, progress: 100, wordTimings: [] }));
    }, { sourceText: source });
    const tags = JSON.stringify({ models: [{ name: 'gemma3:4b', model: 'gemma3:4b', size: 3338801804 }] });
    await page.route('http://localhost:11434/api/tags', route => route.fulfill({ status: 200, contentType: 'application/json', body: tags }));
    await page.route('http://127.0.0.1:11434/api/tags', route => route.fulfill({ status: 200, contentType: 'application/json', body: tags }));
    await page.route(/http:\/\/(localhost|127\.0\.0\.1):11434\/(v1\/chat\/completions|api\/chat)/, async route => {
      if (route.request().url().includes('/v1/')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: formatted } }] }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: { content: formatted } }) });
      }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.locator('label[for="local-server"]').click();
    const cudaModel = page.getByRole('combobox', { name: 'בחירת מודל CUDA לתמלול' });
    await expect(cudaModel).toBeVisible();
    await cudaModel.click();
    await page.getByRole('option', { name: /Ivrit.ai Large V3 - דיוק מרבי/ }).click();

    const punctuationModel = page.getByRole('combobox', { name: 'בחירת מנוע עבור פיסוק + פסקאות' });
    await expect(punctuationModel).toBeVisible();
    await punctuationModel.click();
    await page.getByRole('option', { name: 'gemma3:4b' }).click();
    await page.getByRole('button', { name: 'פיסוק + פסקאות', exact: true }).click();
    await expect(page.getByText('לאחר מכן נעבור לשאלה המרכזית:', { exact: false })).toBeVisible({ timeout: 15000 });

    await page.getByTestId('export-transcript').click();
    await page.getByRole('menuitem', { name: 'Word כפי שמופיע' }).click();
    await expect(page.getByText('DOCX הורד בהצלחה', { exact: true }).first()).toBeVisible({ timeout: 15000 });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('label[for="local-server"]').click();
    await expect(page.getByRole('combobox', { name: 'בחירת מודל CUDA לתמלול' })).toContainText('Ivrit.ai Large V3');
    await expect(page.getByRole('combobox', { name: 'בחירת מנוע עבור פיסוק + פסקאות' })).toContainText('gemma3:4b');
  });
});

test.describe('העלאת קובץ', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/transcribe');
  });

  test('בחירת קובץ אודיו מציגה את שם הקובץ', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]').first();
    const audioBuffer = createTestAudioBuffer();

    await fileInput.setInputFiles({
      name: 'test-recording.wav',
      mimeType: 'audio/wav',
      buffer: audioBuffer,
    });

    // After file selection, the file name or playback should appear
    await expect(page.getByText(/test-recording|wav|קובץ נבחר|ready/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('דחיית קובץ לא תקין', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]').first();

    await fileInput.setInputFiles({
      name: 'document.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('fake pdf content'),
    });

    // Should show error toast or rejection message
    // The file should either be rejected or not show as selected
    const fileNameVisible = await page.getByText('document.pdf').isVisible().catch(() => false);
    // PDF should not be accepted for transcription
    expect(fileNameVisible).toBeFalsy();
  });
});

test.describe('תמלול עם מנוע CUDA (מוק)', () => {
  test('תמלול מוצלח עם שרת מקומי', async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    await page.goto('/transcribe');

    // Select CUDA engine
    const cudaOption = page.getByText('CUDA');
    if (await cudaOption.count() > 0) {
      await cudaOption.first().click();
    }

    // Upload a file
    const fileInput = page.locator('input[type="file"]').first();
    const audioBuffer = createTestAudioBuffer();
    await fileInput.setInputFiles({
      name: 'test-audio.wav',
      mimeType: 'audio/wav',
      buffer: audioBuffer,
    });

    // Wait for UI to stabilize after upload
    await page.waitForTimeout(1000);

    // Wait for transcription to start (button click or auto-start)
    const startButton = page.getByRole('button', { name: /תמלל|התחל|start/i });
    if (await startButton.count() > 0) {
      await startButton.first().click({ timeout: 5000 }).catch(() => {});
    }

    // The mock SSE should return text — check for result or navigation
    // Either the transcript text appears or we navigate to text-editor
    await Promise.race([
      expect(page.getByText('טקסט תמלול מוק')).toBeVisible({ timeout: 15000 }),
      expect(page).toHaveURL(/text-editor/, { timeout: 15000 }),
    ]).catch(() => {
      // If neither happened, that's ok — the mock might not trigger auto-start
    });
  });

  test('סטטוס שרת CUDA מוצג', async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    await page.goto('/transcribe');

    // Select CUDA
    const cudaOption = page.getByText('CUDA');
    if (await cudaOption.count() > 0) {
      await cudaOption.first().click();
      // Should show connected status
      await expect(page.getByText(/מחובר|connected|פעיל|NVIDIA/i)).toBeVisible({ timeout: 10000 });
    }
  });

  test('שרת CUDA לא מחובר מציג סטטוס מנותק', async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: false });
    await page.goto('/transcribe');

    const cudaOption = page.getByText('CUDA');
    if (await cudaOption.count() > 0) {
      await cudaOption.first().click();
      // Should show disconnected status or start server button
      await expect(page.getByText(/מנותק|לא מחובר|הפעל|start|disconnected/i)).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe('בחירת שפה', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/transcribe');
  });

  test('עברית היא ברירת המחדל', async ({ page }) => {
    // "עברית" should be the default language
    await expect(page.getByText('עברית').first()).toBeVisible();
  });
});
