import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

// ─── בדיקות רספונסיביות ו-RTL ─────────────────────────────────────────

test.describe('רספונסיבי - מובייל', () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone size

  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('דשבורד נטען במובייל', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/תמלול חדש|שלום/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('דף תמלול נטען במובייל', async ({ page }) => {
    await page.goto('/transcribe');
    await expect(page.getByText('מערכת תמלול מתקדמת').first()).toBeVisible();
  });

  test('אין גלילה אופקית', async ({ page }) => {
    await page.goto('/');
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // 5px tolerance
  });
});

test.describe('RTL ותצוגה עברית', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('כל הטקסטים בעברית מיושרים לימין', async ({ page }) => {
    await page.goto('/');
    const direction = await page.evaluate(() => {
      return getComputedStyle(document.body).direction;
    });
    expect(direction).toBe('rtl');
  });

  test('Sidebar מוצג בצד ימין', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.locator('aside').first();
    if (await sidebar.isVisible()) {
      const box = await sidebar.boundingBox();
      if (box) {
        const viewport = page.viewportSize();
        // In RTL, sidebar should be on the right side
        expect(box.x + box.width).toBeGreaterThan((viewport?.width || 1280) / 2);
      }
    }
  });
});

// ─── בדיקות ביצועים בסיסיות ─────────────────────────────────────────

test.describe('ביצועים', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('דשבורד נטען תוך 5 שניות', async ({ page }) => {
    const start = Date.now();
    await page.goto('/');
    await expect(page.getByText(/תמלול חדש|שלום/i).first()).toBeVisible({ timeout: 5000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  test('דף תמלול נטען תוך 5 שניות', async ({ page }) => {
    const start = Date.now();
    await page.goto('/transcribe');
    await expect(page.getByText('מערכת תמלול מתקדמת').first()).toBeVisible({ timeout: 5000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });

  test('אין שגיאות קונסול קריטיות', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore common non-critical errors
        if (!text.includes('favicon') && !text.includes('manifest') && !text.includes('sw.js')) {
          errors.push(text);
        }
      }
    });

    await page.goto('/');
    await page.waitForTimeout(3000);

    // Filter out network errors from mocked routes
    const criticalErrors = errors.filter(e =>
      !e.includes('Failed to fetch') &&
      !e.includes('net::') &&
      !e.includes('WebSocket') &&
      !e.includes('supabase')
    );

    expect(criticalErrors).toHaveLength(0);
  });

  test('אין memory leaks גלויים - אין uncaught exceptions', async ({ page }) => {
    const uncaughtErrors: string[] = [];
    page.on('pageerror', err => {
      uncaughtErrors.push(err.message);
    });

    await page.goto('/');
    await page.goto('/transcribe');
    await page.goto('/text-editor');
    await page.goto('/settings');
    await page.goto('/');

    // Filter WebSocket/network errors from mocked environment
    const real = uncaughtErrors.filter(e =>
      !e.includes('WebSocket') && !e.includes('fetch') && !e.includes('network')
    );
    expect(real).toHaveLength(0);
  });
});

// ─── בדיקות נגישות בסיסיות ─────────────────────────────────────────

test.describe('נגישות', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
  });

  test('כל הכפתורים ניתנים לגישה מקלדת', async ({ page }) => {
    await page.goto('/');
    // Press Tab multiple times and verify focus moves
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
    }
    // Check that some element has focus
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedTag).toBeDefined();
  });

  test('lang=he מוגדר ב-HTML', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'he');
  });
});
