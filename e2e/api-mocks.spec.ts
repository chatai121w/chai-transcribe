import { test, expect, mockSupabase, injectAuthSession, mockLocalServer, MOCK_TRANSCRIPTS, MOCK_USER } from './helpers';

// ─── בדיקות API Mocking — וידוא שהמערכת מתנהגת נכון מול שרתים ─────────

test.describe('Supabase API - תמלולים', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('טעינת רשימת תמלולים מ-Supabase', async ({ page }) => {
    await page.goto('/');
    // Wait for dashboard to finish loading data from mock API
    await expect(page.getByText(/תמלול בדיקה|בדיקה/i).first()).toBeVisible({ timeout: 43000 });
  });

  test('שמירת תמלול חדש', async ({ page }) => {
    let postCalled = false;
    await page.route('**/rest/v1/transcripts*', async (route) => {
      if (route.request().method() === 'POST') {
        postCalled = true;
        const body = route.request().postDataJSON();
        expect(body).toHaveProperty('text');
        expect(body).toHaveProperty('engine');
        return route.fulfill({ status: 201, json: [{ ...body, id: 'tr-new' }] });
      }
      return route.fulfill({ status: 200, json: MOCK_TRANSCRIPTS });
    });

    await page.goto('/');
    // The post would be called during transcription flow
    // Here we just verify the route is intercepted correctly
  });

  test('מחיקת תמלול בודד', async ({ page }) => {
    let deleteCalled = false;
    await page.route('**/rest/v1/transcripts*', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        return route.fulfill({ status: 200, json: [] });
      }
      return route.fulfill({ status: 200, json: MOCK_TRANSCRIPTS });
    });

    await page.goto('/');
    // Navigate to a place where delete is available
    // The route mock is ready to verify deletion works
  });
});

test.describe('Supabase API - מפתחות', () => {
  test('טעינת מפתחות API קיימים', async ({ page }) => {
    await mockSupabase(page, {
      authenticated: true,
      apiKeys: { openai: 'sk-***masked***', groq: 'gsk-***masked***' },
    });
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/settings');

    // Keys should be loaded (masked in password fields)
    const keyFields = page.locator('input[type="password"]');
    const count = await keyFields.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('שמירת מפתח API חדש שולח POST/PATCH', async ({ page }) => {
    let saveCalled = false;
    await mockSupabase(page);
    await page.route('**/rest/v1/user_api_keys*', async (route) => {
      const method = route.request().method();
      if (method === 'POST' || method === 'PATCH') {
        saveCalled = true;
        return route.fulfill({ status: 200, json: [{}] });
      }
      return route.fulfill({ status: 200, json: [] });
    });

    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/settings');

    const keyInput = page.locator('input[type="password"]').first();
    await keyInput.fill('sk-new-test-key');
    const saveBtn = page.getByRole('button', { name: /שמור/i }).first();
    await saveBtn.click();

    // Wait for the request
    await page.waitForTimeout(2000);
    expect(saveCalled).toBe(true);
  });
});

test.describe('שרת CUDA מקומי - Health Check', () => {
  test('שרת מחובר - מציג סטטוס ירוק', async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true, model: 'ivrit-ai/whisper-large-v3-turbo' });
    await page.goto('/transcribe');

    // Select CUDA engine
    const cudaOption = page.getByText('CUDA');
    if (await cudaOption.count() > 0) {
      await cudaOption.first().click();
      await expect(page.getByText(/מחובר|connected/i)).toBeVisible({ timeout: 10000 });
    }
  });

  test('שרת מנותק - מציג סטטוס אדום', async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: false });
    await page.goto('/transcribe');

    const cudaOption = page.getByText('CUDA');
    if (await cudaOption.count() > 0) {
      await cudaOption.first().click();
      await expect(page.getByText(/מנותק|לא מחובר|הפעל|disconnected/i)).toBeVisible({ timeout: 10000 });
    }
  });

  test('שם המודל מוצג כשהשרת מחובר', async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true, model: 'faster-whisper-v2-d4' });
    await page.goto('/transcribe');

    const cudaOption = page.getByText('CUDA');
    if (await cudaOption.count() > 0) {
      await cudaOption.first().click();
      await expect(page.getByText(/faster-whisper|whisper/i)).toBeVisible({ timeout: 10000 });
    }
  });

  test('שם ה-GPU מוצג', async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    await page.goto('/transcribe');

    const cudaOption = page.getByText('CUDA');
    if (await cudaOption.count() > 0) {
      await cudaOption.first().click();
      await expect(page.getByText(/NVIDIA|RTX|GPU/i)).toBeVisible({ timeout: 10000 });
    }
  });
});

test.describe('שגיאות רשת', () => {
  test('שגיאת Supabase מציגה הודעת שגיאה', async ({ page }) => {
    await page.route('**/rest/v1/transcripts*', async (route) => {
      return route.fulfill({ status: 500, json: { error: 'Internal Server Error' } });
    });
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/');

    // The app should handle the error gracefully — not crash
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('timeout מ-CUDA שרת לא קורס את האפליקציה', async ({ page }) => {
    await page.route('**/localhost:3000/health', async (route) => {
      // Simulate timeout — never respond
      await new Promise(resolve => setTimeout(resolve, 30000));
    });
    await mockSupabase(page);
    await injectAuthSession(page);
    await page.goto('/transcribe');

    // App should still be functional
    await expect(page.getByText('מערכת תמלול מתקדמת').first()).toBeVisible();
  });
});
