/**
 * E2E — server lifecycle tests
 *
 * Verifies that the CUDA whisper server can be started and stopped
 * reliably, running the full cycle 3 times in a row.
 *
 * Mocks used:
 *  - /__api/start-server      — Vite dev-server proxy for the launcher
 *  - localhost:8764/start     — Launcher tray fallback start
 *  - localhost:8764/stop      — Launcher tray stop
 *  - localhost:3000/health    — Whisper server health (state-driven)
 *  - localhost:3000/shutdown  — Whisper server shutdown
 */

import { test, expect, mockSupabase, injectAuthSession } from './helpers';

// ─── helper: set up all server-related routes with dynamic state ──────────────

async function setupServerMocks(page: import('@playwright/test').Page) {
  let serverRunning = false;

  // Health endpoint — state-driven
  await page.route('**/localhost:3000/health', (route) => {
    if (serverRunning) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          device: 'cuda',
          gpu: 'NVIDIA GeForce RTX Test GPU',
          current_model: 'ivrit-ai/faster-whisper-v3-d4',
          downloaded_models: ['ivrit-ai/faster-whisper-v3-d4'],
          model_ready: false,
          model_loading: false,
        }),
      });
    }
    return route.abort('connectionrefused');
  });

  // Shutdown endpoint — sets state to off
  await page.route('**/localhost:3000/shutdown', (route) => {
    serverRunning = false;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'shutting_down' }) });
  });

  // Launcher start (Vite proxy path — localhost as base)
  await page.route('**/__api/start-server', (route) => {
    serverRunning = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message: 'started' }) });
  });

  // Launcher tray fallback (port 8764)
  await page.route('**/localhost:8764/start', (route) => {
    serverRunning = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, results: { whisper: { message: 'started' } } }),
    });
  });

  // Launcher tray stop
  await page.route('**/localhost:8764/stop', (route) => {
    serverRunning = false;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  // Other whisper endpoints (not needed for lifecycle but prevent unhandled errors)
  await page.route('**/localhost:3000/models', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [], current: null }) })
  );
  await page.route('**/localhost:3000/downloaded-models', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ models: [] }) })
  );
  // NOTE: no catch-all — Playwright uses LIFO so a catch-all registered last would override specific routes above

  // Expose a setter so the test can inspect / reset the state
  return {
    get serverRunning() { return serverRunning; },
    stop() { serverRunning = false; },
  };
}

// ─── select the CUDA engine via the RadioGroup ───────────────────────────────
async function selectCudaEngine(page: import('@playwright/test').Page) {
  // The label wrapping RadioGroupItem[value="local-server"]
  const cudaLabel = page.locator('label[for="local-server"]');
  await cudaLabel.click();
  // Server status panel should appear
  await expect(page.locator('#local-server')).toBeChecked({ timeout: 3000 });
}

// ─── tests ───────────────────────────────────────────────────────────────────

test.describe('CUDA Server Lifecycle', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    // Pre-select CUDA engine in localStorage so the page loads with it
    await page.addInitScript(() => {
      localStorage.setItem('preferred_engine', 'local-server');
    });
  });

  // ── Test 1: basic start + stop ─────────────────────────────────────────────
  test('הפעלה וכיבוי בסיסיים של שרת CUDA', async ({ page }) => {
    const server = await setupServerMocks(page);
    await page.goto('/transcribe');
    await selectCudaEngine(page);

    // Initially disconnected
    await expect(page.getByText(/לא מחובר — הפעל שרת CUDA/)).toBeVisible({ timeout: 3000 });
    expect(server.serverRunning).toBe(false);

    // ── Start ───────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'הפעל שרת' }).click();

    // Wait for "מחובר" status (server mock responds to health immediately)
    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 12000 });
    expect(server.serverRunning).toBe(true);

    // ── Stop ────────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'כבה שרת' }).click();

    await expect(page.getByText(/לא מחובר — הפעל שרת CUDA/)).toBeVisible({ timeout: 8000 });
    expect(server.serverRunning).toBe(false);
  });

  // ── Test 2: start shows "ממתין לחיבור..." spinner text ───────────────────
  test('כפתור הפעלה מציג מצב "ממתין לחיבור..." בזמן ההפעלה', async ({ page }) => {
    // Make health always fail so we can observe the waiting state
    await page.route('**/localhost:3000/health', (route) => route.abort('connectionrefused'));
    await page.route('**/__api/start-server', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message: 'started' }) })
    );
    await page.route('**/localhost:8764/start', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, results: { whisper: { message: 'started' } } }) })
    );
    await page.route('**/localhost:8764/stop', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }));
    await page.route('**/localhost:3000/**', (route) => route.abort('connectionrefused'));

    await page.goto('/transcribe');
    await selectCudaEngine(page);

    await page.getByRole('button', { name: 'הפעל שרת' }).click();

    // Should immediately show waiting state — button text changes to spinner
    await expect(page.getByRole('button', { name: /ממתין לחיבור/ })).toBeVisible({ timeout: 3000 });
  });

  // ── Test 3: 3x start/stop cycle ───────────────────────────────────────────
  test('מחזור הפעלה/כיבוי x3 ללא תקלות', async ({ page }) => {
    const server = await setupServerMocks(page);
    await page.goto('/transcribe');
    await selectCudaEngine(page);

    for (let cycle = 1; cycle <= 3; cycle++) {
      // ── Start ──────────────────────────────────────────────────────────
      await expect(page.getByRole('button', { name: 'הפעל שרת' })).toBeVisible({ timeout: 8000 });
      expect(server.serverRunning).toBe(false);

      await page.getByRole('button', { name: 'הפעל שרת' }).click();

      await expect(page.getByText('מחובר')).toBeVisible({ timeout: 12000 });
      expect(server.serverRunning).toBe(true);

      // Verify "כבה שרת" button visible = server connected + GPU badge shown
      await expect(page.getByRole('button', { name: 'כבה שרת' })).toBeVisible({ timeout: 3000 });

      // ── Stop ───────────────────────────────────────────────────────────
      await page.getByRole('button', { name: 'כבה שרת' }).click();

      await expect(page.getByRole('button', { name: 'הפעל שרת' })).toBeVisible({ timeout: 8000 });
      expect(server.serverRunning).toBe(false);

      // Short pause between cycles
      await page.waitForTimeout(300);
    }
  });

  // ── Test 4: server already running on load ────────────────────────────────
  test('מציג "מחובר" אם השרת כבר עלה לפני כניסה לדף', async ({ page }) => {
    // Health returns OK immediately (server was already running)
    await page.route('**/localhost:3000/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          device: 'cuda',
          gpu: 'NVIDIA GeForce RTX Test GPU',
          current_model: 'ivrit-ai/faster-whisper-v3-d4',
          downloaded_models: [],
          model_ready: false,
          model_loading: false,
        }),
      })
    );
    await page.route('**/localhost:3000/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('**/localhost:8764/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    await page.goto('/transcribe');
    await selectCudaEngine(page);

    // "הפעל שרת" button should NOT appear
    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('הפעל שרת')).not.toBeVisible();
    // "כבה שרת" button should be visible
    await expect(page.getByText('כבה שרת')).toBeVisible();
  });

  // ── Test 5: server failed to start shows error toast ─────────────────────
  test('מציג הודעת שגיאה כאשר ההפעלה נכשלת', async ({ page }) => {
    // All start endpoints fail
    await page.route('**/__api/start-server', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Process failed to start' }) }));
    await page.route('**/localhost:8764/start', (route) => route.abort('connectionrefused'));
    await page.route('**/localhost:3000/**', (route) => route.abort('connectionrefused'));

    await page.goto('/transcribe');
    await selectCudaEngine(page);

    await page.getByRole('button', { name: 'הפעל שרת' }).click();

    // Should show error toast
    await expect(page.getByText('שגיאה בהפעלת השרת').first()).toBeVisible({ timeout: 10000 });
    // Button should reset (not stuck in loading)
    await expect(page.getByRole('button', { name: 'הפעל שרת' })).toBeVisible({ timeout: 8000 });
  });
});
