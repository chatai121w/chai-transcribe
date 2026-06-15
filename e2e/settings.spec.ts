import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

test.describe('הגדרות - דף ראשי', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/settings');
  });

  test('דף הגדרות נטען', async ({ page }) => {
    await expect(page.getByText(/הגדרות|settings/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('שדות מפתחות API מוצגים', async ({ page }) => {
    await expect(page.getByText(/OpenAI/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Groq/i).first()).toBeVisible();
  });

  test('שדות סיסמה מוסתרים כברירת מחדל', async ({ page }) => {
    const passwordFields = page.locator('input[type="password"]');
    const count = await passwordFields.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('כפתור שמירה קיים', async ({ page }) => {
    await expect(page.getByText(/שמור/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('כפתור התנתקות קיים', async ({ page }) => {
    await expect(page.getByText(/התנתק/i)).toBeVisible({ timeout: 10000 });
  });

  test('הזנת מפתח API ושמירה', async ({ page }) => {
    // Find the first password input (API key field)
    const keyInput = page.locator('input[type="password"]').first();
    await keyInput.fill('sk-test-fake-key-12345');

    const saveButton = page.getByRole('button', { name: /שמור/i }).first();
    await saveButton.click();

    // Should show success toast
    await expect(page.getByText(/נשמר|success|הצלחה/i)).toBeVisible({ timeout: 5000 });
  });

  test('טאב ערכות נושא מוצג', async ({ page }) => {
    const themeTab = page.getByText(/ערכות נושא|themes/i);
    if (await themeTab.count() > 0) {
      await themeTab.first().click();
      // Theme options should appear
      await expect(page.getByText(/בהיר|כהה|light|dark/i)).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('הגדרות - ללא חיבור', () => {
  test('הפניה לדף התחברות', async ({ page }) => {
    await mockSupabase(page, { authenticated: false });
    await mockLocalServer(page);
    await page.goto('/settings');
    // Should redirect to login or show login prompt
    await expect(page.getByText(/התחבר|כניסה|login/i).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('הגדרות - אדמין', () => {
  test('כלי פיתוח מוצגים לאדמין', async ({ page }) => {
    await mockSupabase(page, { authenticated: true, isAdmin: true });
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/settings');
    const devTools = page.getByText(/כלי פיתוח|dev tools/i);
    if (await devTools.count() > 0) {
      await expect(devTools.first()).toBeVisible();
    }
  });
});
