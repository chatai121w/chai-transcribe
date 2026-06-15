import { test, expect } from './helpers';

/**
 * E2E: Live Design Mode always opens the color editor on element click.
 * Covers regression where pointer events were swallowed by underlying
 * React handlers (theme cards) instead of opening the editor.
 */
test.describe('Live Design Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Pre-seed the editor layout so the panel is NOT minimized from a prior run.
    await page.addInitScript(() => {
      localStorage.setItem(
        'design_mode_editor_layout_v1',
        JSON.stringify({ width: 460, height: 560, x: 40, y: 80, minimized: false }),
      );
      localStorage.removeItem('design_overrides_v1');
    });
  });

  for (const route of ['/', '/settings']) {
    test(`opens color editor when clicking an element on ${route}`, async ({ page }) => {
      // Activate design mode via the documented URL param.
      await page.goto(`${route}${route.includes('?') ? '&' : '?'}designMode=1`);

      // Toolbar should appear, proving the overlay mounted.
      await expect(page.getByText('מצב עיצוב חי')).toBeVisible({ timeout: 15_000 });

      // Find a real, visible content element to click.
      // We pick the first <h1> or <h2>; falling back to any visible button.
      const target = page.locator('h1, h2, [role="heading"]').first();
      await expect(target).toBeVisible();

      const box = await target.boundingBox();
      expect(box).not.toBeNull();

      // Click in the middle of the element. pointerdown is what the overlay listens to.
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.mouse.down();
      await page.mouse.up();

      // The element editor panel must appear with the color inputs.
      await expect(page.getByText('עריכת אלמנט:')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText('צבע טקסט')).toBeVisible();
      await expect(page.getByText('צבע רקע')).toBeVisible();
      await expect(page.getByText('צבע מסגרת')).toBeVisible();

      // At least one <input type="color"> must be in the DOM.
      const colorInputs = page.locator('input[type="color"]');
      await expect(colorInputs.first()).toBeVisible();
      expect(await colorInputs.count()).toBeGreaterThanOrEqual(3);
    });
  }

  test('clicking does NOT trigger underlying app navigation', async ({ page }) => {
    await page.goto('/settings?designMode=1');
    await expect(page.getByText('מצב עיצוב חי')).toBeVisible({ timeout: 15_000 });

    const startUrl = page.url();

    // Click anything clickable — design mode should swallow it.
    const anyButton = page.locator('button:visible').first();
    await anyButton.click({ force: true, noWaitAfter: true }).catch(() => { /* ignore */ });

    // Editor opens.
    await expect(page.getByText('עריכת אלמנט:')).toBeVisible({ timeout: 5_000 });
    // URL did not change.
    expect(page.url()).toBe(startUrl);
  });

  test('still opens color editor after page reload', async ({ page }) => {
    await page.goto('/settings?designMode=1');
    await expect(page.getByText('מצב עיצוב חי')).toBeVisible({ timeout: 15_000 });

    // Reload the page — design mode must persist via the ?designMode=1 URL param.
    await page.reload();
    await expect(page.getByText('מצב עיצוב חי')).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain('designMode=1');

    // Click an element after reload and confirm the color editor opens.
    const target = page.locator('h1, h2, [role="heading"]').first();
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    await expect(page.getByText('עריכת אלמנט:')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('צבע טקסט')).toBeVisible();
    await expect(page.locator('input[type="color"]').first()).toBeVisible();
  });
});
});
