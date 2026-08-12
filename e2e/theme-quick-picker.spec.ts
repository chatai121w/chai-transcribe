import { expect, test, injectAuthSession, mockLocalServer, mockSupabase } from './helpers';

test.describe('בורר ערכות נושא מהסיידבר', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await mockLocalServer(page);
    await injectAuthSession(page);
  });

  test('פותח בורר, מחליף ערכה ושומר אותה אחרי ריענון', async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/translation');
    await page.getByRole('button', { name: 'פתח תפריט' }).click();
    await page.getByRole('button', { name: 'פתח בורר ערכות נושא' }).click();

    await expect(page.getByText('תצוגת נושא', { exact: true })).toBeVisible();
    await expect(page.getByText('בחר מראה לכל המערכת', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /זהב מלכותי/ })).toBeVisible();

    await page.getByRole('button', { name: /זהב מלכותי/ }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('app_theme_id'))).toBe('royal-gold');
    await expect(page.getByRole('button', { name: /זהב מלכותי/ })).toHaveAttribute('aria-pressed', 'true');

    await page.reload();
    await page.getByRole('button', { name: 'פתח תפריט' }).click();
    await page.getByRole('button', { name: 'פתח בורר ערכות נושא' }).click();
    await expect(page.getByRole('button', { name: /זהב מלכותי/ })).toHaveAttribute('aria-pressed', 'true');

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('כפתור הניהול פותח את מסך ערכות הנושא המלא', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/translation');
    await page.mouse.move(1278, 100);
    await expect(page.getByText('ניווט', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'פתח בורר ערכות נושא' }).click();
    await page.getByRole('button', { name: 'ניהול ויצירת ערכות נושא' }).click();
    await expect(page).toHaveURL(/\/settings#themes-section/);
    await expect(page.getByRole('heading', { name: 'ערכות נושא' }).first()).toBeVisible();
  });
});
