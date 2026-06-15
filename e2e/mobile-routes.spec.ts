import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

const protectedRoutes = [
  '/',
  '/transcribe',
  '/text-editor',
  '/settings',
  '/folders',
  '/benchmark',
  '/video-to-mp3',
  '/setup',
] as const;

test.describe('מובייל - smoke על כל הראוטים הראשיים', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await mockLocalServer(page);
  });

  for (const route of protectedRoutes) {
    test(`טעינת ${route} ללא גלילה אופקית`, async ({ page }) => {
      await injectAuthSession(page);
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(route === '/' ? '/$' : route.replace('/', '\\/')), { timeout: 30000 });

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
    });
  }

  test('login נטען תקין במובייל', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
    await expect(page.getByText(/התחבר|כניסה/i).first()).toBeVisible({ timeout: 30000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });

  test('404 נטען תקין במובייל', async ({ page }) => {
    await page.goto('/nonexistent-mobile-route-check');
    await expect(page.getByText(/404|לא נמצא|not found/i).first()).toBeVisible({ timeout: 30000 });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });
});
