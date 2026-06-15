import { test, expect } from '@playwright/test';

const APP_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8091';
const EMAIL = 'jj1212t@gmail.com';
const PASSWORD = '543211';

test.describe('Studio Layout Recovery (Real E2E)', () => {
  test('self-heals broken player layout and persists fixed values', async ({ page }) => {
    await page.goto(`${APP_URL}/text-editor`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // Login only if we were redirected to the login screen.
    if (page.url().includes('/login')) {
      const emailInput = page.locator('input[placeholder="כתובת אימייל"], input[type="email"]').first();
      const passwordInput = page.locator('input[placeholder="סיסמה"], input[type="password"]').first();

      await expect(emailInput).toBeVisible({ timeout: 20_000 });
      await emailInput.fill(EMAIL);
      await passwordInput.fill(PASSWORD);
      await passwordInput.press('Enter');

      await page.waitForTimeout(1000);
    }

    // Open an existing transcript in the editor.
    // In some sessions /text-editor already contains an active transcript;
    // in others we need to jump to dashboard and click "ערוך".
    let editButton = page.getByRole('button', { name: 'ערוך' }).first();
    if ((await editButton.count()) === 0) {
      await page.goto(`${APP_URL}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      editButton = page.getByRole('button', { name: 'ערוך' }).first();
    }

    if ((await editButton.count()) > 0) {
      await expect(editButton).toBeVisible({ timeout: 30_000 });
      await editButton.click();
    }

    if (!page.url().includes('/text-editor')) {
      test.skip(true, 'Could not reach /text-editor in this environment (auth gate still active)');
    }
    await expect(page).toHaveURL(/\/text-editor/, { timeout: 30_000 });
    await page.waitForTimeout(1000);

    // Move to player tab so the studio grid is mounted.
    const playerTab = page.getByRole('tab', { name: /נגן/ }).first();
    await playerTab.click();
    await page.waitForTimeout(1200);

    // Ensure this transcript has audio (otherwise the grid is not mounted).
    if ((await page.getByText('אין קובץ אודיו').count()) > 0) {
      test.skip(true, 'No audio transcript available in this environment right now');
    }

    // Inject a known broken layout state that causes overlap/packed-left rendering.
    await page.evaluate(() => {
      localStorage.setItem('studio_widget_layouts_v5', JSON.stringify({
        lg: [
          { i: 'player', x: 0, y: 0, w: 4, h: 10, minW: 4, minH: 6 },
          { i: 'studio', x: 1, y: 0, w: 4, h: 10, minW: 4, minH: 6 },
        ],
        md: [
          { i: 'player', x: 0, y: 0, w: 10, h: 18, minW: 4, minH: 6 },
          { i: 'studio', x: 0, y: 18, w: 10, h: 30, minW: 4, minH: 6 },
        ],
        sm: [
          { i: 'player', x: 0, y: 0, w: 6, h: 18 },
          { i: 'studio', x: 0, y: 18, w: 6, h: 30 },
        ],
      }));
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    // After reload the tab defaults to edit. Go back to player tab and inspect layout.
    await page.getByRole('tab', { name: /נגן/ }).first().click();
    await page.waitForTimeout(1200);

    const layoutState = await page.evaluate(() => {
      const grid = document.querySelector('.studio-grid') as HTMLElement | null;
      const items = Array.from(document.querySelectorAll('.studio-grid .react-grid-item')) as HTMLElement[];
      const tops = items.map((it) => it.getBoundingClientRect().top);
      const sortedTops = [...tops].sort((a, b) => a - b);
      const topGap = sortedTops.length >= 2 ? Math.abs(sortedTops[1] - sortedTops[0]) : 9999;

      const boxes = items.slice(0, 2).map((it) => {
        const r = it.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });

      const namedBoxes = items.slice(0, 2).map((it) => {
        const r = it.getBoundingClientRect();
        const title = (it.querySelector('.studio-widget-handle span') as HTMLElement | null)?.textContent || '';
        return { title, x: r.x, y: r.y, w: r.width, h: r.height, right: r.right };
      });

      const overlap = boxes.length < 2
        ? true
        : (
            boxes[0].x < boxes[1].x + boxes[1].w &&
            boxes[1].x < boxes[0].x + boxes[0].w &&
            boxes[0].y < boxes[1].y + boxes[1].h &&
            boxes[1].y < boxes[0].y + boxes[0].h
          );

      const storedRaw = localStorage.getItem('studio_widget_layouts_v5');
      const stored = storedRaw ? JSON.parse(storedRaw) : null;

      return {
        hasGrid: !!grid,
        itemCount: items.length,
        topGap,
        overlap,
        viewportWidth: window.innerWidth,
        namedBoxes,
        stored,
      };
    });

    expect(layoutState.hasGrid).toBeTruthy();
    expect(layoutState.itemCount).toBeGreaterThanOrEqual(2);

    // Healed layout should not have huge vertical gap between the first 2 widgets.
    expect(layoutState.topGap).toBeLessThan(140);

    // Widgets should not overlap after healing.
    expect(layoutState.overlap).toBeFalsy();

    // Widgets must remain fully inside viewport (no off-page drift on right side).
    for (const box of layoutState.namedBoxes as Array<{ x: number; right: number }>) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(layoutState.viewportWidth + 2);
    }

    // Expected horizontal order in player tab: player widget should be left of studio widget.
    const playerBox = (layoutState.namedBoxes as Array<{ title: string; x: number }>).find((b) => b.title.includes('נגן'));
    const studioBox = (layoutState.namedBoxes as Array<{ title: string; x: number }>).find((b) => b.title.includes('סטודיו'));
    if (playerBox && studioBox) {
      expect(playerBox.x).toBeLessThan(studioBox.x);
    }

    // Persisted healed layout should move studio to a proper second column in lg.
    const healedStudio = layoutState.stored?.lg?.find((x: { i: string; y: number; x: number }) => x.i === 'studio');
    expect(healedStudio?.x).toBeGreaterThanOrEqual(5);
    expect(healedStudio?.y).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: 'test-results/studio-layout-recovery-real.png',
      fullPage: true,
    });
  });
});
