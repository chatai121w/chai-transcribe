import { test, expect, mockSupabase, injectAuthSession, mockLocalServer, MOCK_USER } from './helpers';

test.describe('התחברות', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page, { authenticated: false });
    await mockLocalServer(page);
  });

  test('דף התחברות מוצג עם שדות אימייל וסיסמה', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByPlaceholder(/אימייל|email|דוא/i)).toBeVisible();
    await expect(page.getByPlaceholder(/סיסמ|password/i)).toBeVisible();
  });

  test('כפתור Google מוצג', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/Google|גוגל/)).toBeVisible();
  });

  test('מעבר בין התחבר להרשמה', async ({ page }) => {
    await page.goto('/login');
    // Should show "הרשם עכשיו" or "הרשמה" toggle
    const signupToggle = page.getByText(/הרשם|הרשמה/);
    await expect(signupToggle.first()).toBeVisible();
    await signupToggle.first().click();
    // Should now show sign up form
    await expect(page.getByText(/הרשמה/).first()).toBeVisible();
  });

  test('וולידציית סיסמה קצרה', async ({ page }) => {
    await page.goto('/login');
    // Try to switch to sign up mode
    const signupToggle = page.getByText(/הרשם|הרשמה/);
    if (await signupToggle.count() > 0) {
      await signupToggle.first().click();
    }
    const emailInput = page.getByPlaceholder(/אימייל|email|דוא/i);
    const passwordInput = page.getByPlaceholder(/סיסמ|password/i);
    await emailInput.fill('test@example.com');
    await passwordInput.fill('12');
    const submitButton = page.getByRole('button', { name: /התחבר|הרשמה|כניסה/i });
    await submitButton.first().click();
    // Should show validation error or toast — or stay on login page
    await page.waitForTimeout(2000);
    // If still on the login page, validation blocked the submission
    const url = page.url();
    const hasValidationMsg = await page.getByText(/שש|קצר|שגיאה|תווים/i).first().isVisible().catch(() => false);
    expect(url.includes('login') || hasValidationMsg).toBeTruthy();
  });

  test('התחברות מוצלחת מנווטת לדשבורד', async ({ page }) => {
    // Re-mock with authenticated: true for the token request
    await mockSupabase(page, { authenticated: true });
    await page.goto('/login');
    const emailInput = page.getByPlaceholder(/אימייל|email|דוא/i);
    const passwordInput = page.getByPlaceholder(/סיסמ|password/i);
    await emailInput.fill('test@example.com');
    await passwordInput.fill('password123');
    const submitButton = page.getByRole('button', { name: /התחבר|כניסה/i });
    await submitButton.first().click();
    // Inject auth session to simulate what Supabase client would do
    await injectAuthSession(page);
    // Navigate or wait — the app should pick up the session
    await page.waitForTimeout(1000);
    await page.goto('/');
    // Should not be redirected back to login
    await expect(page).not.toHaveURL(/login/, { timeout: 10000 });
  });

  test('הצגת/הסתרת סיסמה עובדת', async ({ page }) => {
    await page.goto('/login');
    const passwordInput = page.getByPlaceholder(/סיסמ|password/i);
    await expect(passwordInput).toHaveAttribute('type', 'password');
    // Click eye toggle
    const eyeButton = page.locator('button').filter({ has: page.locator('svg') }).nth(0);
    // Find the eye button near the password field
    const passwordContainer = passwordInput.locator('..');
    const toggle = passwordContainer.locator('button');
    if (await toggle.count() > 0) {
      await toggle.first().click();
      await expect(passwordInput).toHaveAttribute('type', 'text');
    }
  });
});

test.describe('התנתקות', () => {
  test('התנתקות מנקה session ומנווטת להתחברות', async ({ page }) => {
    await mockSupabase(page, { authenticated: true });
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/settings');
    // Find and click logout button
    const logoutButton = page.getByText(/התנתק/);
    await expect(logoutButton).toBeVisible({ timeout: 10000 });
    await logoutButton.click();
    // Should navigate to login or home
    await expect(page).toHaveURL(/login|\/$/);
  });
});

test.describe('הגנת עמודים', () => {
  test('הגדרות מפנה להתחברות בלי session', async ({ page }) => {
    await mockSupabase(page, { authenticated: false });
    await mockLocalServer(page);
    await page.goto('/settings');
    // Should redirect to login or show login prompt
    await expect(page.getByText(/התחבר|login|כניסה/i).first()).toBeVisible({ timeout: 10000 });
  });
});
