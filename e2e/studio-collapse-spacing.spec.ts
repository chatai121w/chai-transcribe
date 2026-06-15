import { test, expect, mockSupabase, injectAuthSession, mockLocalServer, MOCK_TRANSCRIPTS } from './helpers';

test.describe('Studio collapse spacing', () => {
  test.beforeEach(async ({ page }) => {
    const transcriptWithAudio = {
      ...MOCK_TRANSCRIPTS[1],
      id: 'tr-audio-only',
      created_at: new Date().toISOString(),
      audio_file_path: 'test-audio.webm',
    };

    await mockSupabase(page, { transcripts: [transcriptWithAudio] });
    await injectAuthSession(page);
    await mockLocalServer(page);

    await page.addInitScript(() => {
      // Start from a deliberately broken large-gap layout state.
      localStorage.setItem('studio_widget_layouts_v5', JSON.stringify({
        lg: [
          { i: 'player', x: 0, y: 0, w: 12, h: 18, minW: 4, minH: 6 },
          { i: 'studio', x: 0, y: 40, w: 12, h: 28, minW: 4, minH: 6 },
        ],
        md: [
          { i: 'player', x: 0, y: 0, w: 10, h: 18, minW: 4, minH: 6 },
          { i: 'studio', x: 0, y: 40, w: 10, h: 28, minW: 4, minH: 6 },
        ],
        sm: [
          { i: 'player', x: 0, y: 0, w: 6, h: 18 },
          { i: 'studio', x: 0, y: 40, w: 6, h: 28 },
        ],
      }));

      // Load minimized panel preferences to reproduce the real-world issue.
      localStorage.setItem('sap_audio_prefs_v1', JSON.stringify({
        isNoisePanelCollapsed: true,
        isFocusPanelCollapsed: true,
        isMixerConsoleCollapsed: true,
      }));
    });
  });

  test('collapsed widgets do not leave large vertical gaps', async ({ page }) => {
    await page.goto('/text-editor', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);

    // If the editor has no active transcript, open one from dashboard.
    if ((await page.locator('.studio-grid .react-grid-item').count()) < 2) {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      const editButton = page.getByRole('button', { name: 'ערוך' }).first();
      if (await editButton.count()) {
        await editButton.click();
        await page.waitForTimeout(1200);
      }
    }

    const playerTab = page.getByRole('tab', { name: /נגן/ }).first();
    if (await playerTab.count()) {
      await playerTab.click();
    }

    await page.waitForTimeout(1200);

    const hasNoAudioMessage = (await page.getByText('אין קובץ אודיו').count()) > 0;
    const gridCount = await page.locator('.studio-grid .react-grid-item').count();
    test.skip(hasNoAudioMessage || gridCount < 2, 'No audio-backed studio grid available in this run');

    const state = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.studio-grid .react-grid-item')) as HTMLElement[];
      const sorted = items
        .map((it) => {
          const r = it.getBoundingClientRect();
          const title = (it.querySelector('.studio-widget-handle span') as HTMLElement | null)?.textContent || '';
          return { top: r.top, bottom: r.bottom, height: r.height, title };
        })
        .sort((a, b) => a.top - b.top);

      const verticalGap = sorted.length >= 2 ? Math.max(0, sorted[1].top - sorted[0].bottom) : 9999;

      const storedRaw = localStorage.getItem('studio_widget_layouts_v5');
      const stored = storedRaw ? JSON.parse(storedRaw) : null;
      const lg = Array.isArray(stored?.lg) ? stored.lg : [];
      const player = lg.find((x: { i: string; y: number; h: number }) => x.i === 'player');
      const studio = lg.find((x: { i: string; y: number; h: number }) => x.i === 'studio');
      const gridUnitsGap = player && studio ? Math.max(0, studio.y - (player.y + player.h)) : 9999;

      return {
        itemCount: sorted.length,
        verticalGap,
        gridUnitsGap,
        sorted,
      };
    });

    expect(state.itemCount).toBeGreaterThanOrEqual(2);
    expect(state.verticalGap).toBeLessThan(24);
    expect(state.gridUnitsGap).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: 'test-results/studio-collapse-spacing.png',
      fullPage: true,
    });
  });
});
