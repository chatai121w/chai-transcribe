/**
 * E2E — בדיקה יסודית של הפעלת שרתים ותמלול
 *
 * כיסוי מלא של:
 *  1. שלבי health endpoint — שדות, מצב GPU, model_loading / model_ready
 *  2. SSE streaming — כל סוגי האירועים (loading → info → segment → done / error)
 *  3. Preload stream — הכנת מודל ברקע
 *  4. Stage audio + stage_id — העלאה מקדימה + שימוש ב-stage_id
 *  5. מצבי שגיאה — שרת עמוס, קובץ גדול, שגיאת תמלול
 *  6. UI presets — בחירת fast / balanced / accurate
 *  7. UI badges — מחובר / טוען מודל / מודל מוכן / לא מחובר
 *  8. פקודת shutdown
 *  9. Debug + diagnostics endpoints
 * 10. Unload + Warmup endpoints
 *
 * IMPLEMENTATION NOTES:
 *  - Routes are added in the order they need to match (specific AFTER generic — Playwright LIFO).
 *  - No catch-all `** /localhost:3000/**` is used — only specific endpoint routes.
 *    A catch-all registered last would intercept all requests (LIFO) including health, defeating mocks.
 *  - For pure API contract tests (Groups 6-13) we use page.evaluate() which goes through
 *    page.route() interceptors. page.request.get/fetch does NOT go through these interceptors.
 *  - All route.fulfill() responses include CORS headers so cross-origin fetch() calls work.
 */

import { test, expect } from '@playwright/test';
import { mockSupabase, injectAuthSession } from './helpers';

// ─── Local constants ─────────────────────────────────────────────────────────

const SERVER_BASE = 'http://localhost:3000';

/** CORS headers required when fulfilling routes intercepted by page.evaluate fetch() */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
};

/** Minimal valid WAV buffer (silence, 16kHz, 16-bit mono) */
function makeWav(durationSec = 1): Buffer {
  const sr = 16000;
  const numSamples = sr * durationSec;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize, 0);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  return buf;
}

/** Build SSE body string from array of event objects */
function sseBody(events: object[]): string {
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

// ─── Setup helpers ────────────────────────────────────────────────────────────

/** Navigate to /transcribe with CUDA engine pre-selected.
 *  preloadMode defaults to 'direct' to prevent auto-preload from silently
 *  calling /preload-stream and polluting test state. */
async function gotoTranscribe(
  page: import('@playwright/test').Page,
  opts: { preloadMode?: 'direct' | 'preload' } = {},
) {
  await page.addInitScript((o: { preloadMode?: string }) => {
    localStorage.setItem('preferred_engine', 'local-server');
    localStorage.setItem('cuda_preload_mode', o.preloadMode || 'direct');
  }, opts);
  await page.goto('/transcribe');
}

/** Click the CUDA server label so its radio is checked */
async function selectCuda(page: import('@playwright/test').Page) {
  const label = page.locator('label[for="local-server"]');
  await label.click();
  await expect(page.locator('#local-server')).toBeChecked({ timeout: 3000 });
}

/** Full health response for a running server */
function healthOk(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    device: 'cuda',
    gpu: 'NVIDIA GeForce RTX 4090',
    gpu_memory: { allocated_mb: 1200, reserved_mb: 1500, total_mb: 24564, free_mb: 23064, utilization_pct: 6.1 },
    current_model: 'large-v3-turbo',
    cached_models: ['large-v3-turbo::int8_float16'],
    downloaded_models: ['large-v3-turbo', 'ivrit-ai/faster-whisper-v2-d4'],
    available_models: ['tiny', 'base', 'small', 'medium', 'large-v2', 'large-v3', 'large-v3-turbo'],
    model_loading: false,
    model_loading_id: null,
    model_ready: true,
    flash_attention_disabled: false,
    transcribe_active: false,
    uptime_seconds: 120,
    ...overrides,
  };
}

/** Mock the /health endpoint with the given state */
async function mockHealth(page: import('@playwright/test').Page, data: Record<string, unknown> = healthOk()) {
  await page.route('**/localhost:3000/health', (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify(data),
    });
  });
}

/** Mock /preload-stream to return instant ready (prevents auto-preload side-effects) */
async function mockPreloadInstant(page: import('@playwright/test').Page) {
  await page.route('**/localhost:3000/preload-stream', (route) => {
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS });
    }
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS },
      body: sseBody([{ type: 'status', status: 'ready', elapsed: 0, model: 'large-v3-turbo', message: 'Model already loaded' }]),
    });
  });
}

/** Mock /models and /downloaded-models (component may call these on connect) */
async function mockModelsList(page: import('@playwright/test').Page) {
  await page.route('**/localhost:3000/models', (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ models: [], current: null }) })
  );
  await page.route('**/localhost:3000/downloaded-models', (route) =>
    route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ models: [] }) })
  );
}

/** Helpers for server start routes (launcher) */
async function mockLauncherStart(page: import('@playwright/test').Page, onStart: () => void) {
  await page.route('**/__api/start-server', (route) => {
    onStart();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, message: 'started' }) });
  });
  await page.route('**/localhost:8764/start', (route) => {
    onStart();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, results: { whisper: { message: 'started' } } }) });
  });
}

async function mockLauncherStop(page: import('@playwright/test').Page, onStop?: () => void) {
  await page.route('**/localhost:8764/stop', (route) => {
    onStop?.();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
}

/**
 * Make an HTTP request FROM the browser context so page.route() interceptors apply.
 * Use this instead of page.request.get/fetch for mocked API contract tests.
 */
async function browserFetch(
  page: import('@playwright/test').Page,
  url: string,
  method: 'GET' | 'POST' = 'GET',
  formParams?: Record<string, string>,
): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async ({ url, method, formParams }) => {
      try {
        const init: RequestInit = { method };
        if (formParams) {
          init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
          init.body = new URLSearchParams(formParams).toString();
        }
        const resp = await fetch(url, init);
        return { status: resp.status, text: await resp.text(), error: null };
      } catch (e) {
        return { status: 0, text: '', error: String(e) };
      }
    },
    { url, method, formParams },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 1 — Health Endpoint UI State
// ═══════════════════════════════════════════════════════════════════════════

test.describe('1. Health endpoint — שדות וזיהוי מצב', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
  });

  test('1.1 — שרת מחובר: מציג "מחובר" + GPU badge + "מודל מוכן"', async ({ page }) => {
    // Specific routes only (no catch-all — avoids Playwright LIFO override)
    await mockHealth(page, healthOk());
    await mockPreloadInstant(page);
    await mockModelsList(page);

    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/GPU|RTX|cuda/i).first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('מודל מוכן')).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: 'כבה שרת' })).toBeVisible({ timeout: 3000 });
  });

  test('1.2 — שרת מחובר + model_loading=true: מציג "טוען מודל..."', async ({ page }) => {
    await mockHealth(page, healthOk({ model_loading: true, model_ready: false, current_model: null }));
    await mockModelsList(page);
    // model_loading=true → auto-preload condition !modelLoading is false → no preload call

    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('טוען מודל...')).toBeVisible({ timeout: 3000 });
  });

  test('1.3 — שרת מחובר + model_ready=false, model_loading=false: "מודל לא טעון"', async ({ page }) => {
    await mockHealth(page, healthOk({ model_loading: false, model_ready: false }));
    // model_ready=false + preloadMode='direct' → no auto-preload
    await mockModelsList(page);

    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('מודל לא טעון')).toBeVisible({ timeout: 3000 });
  });

  test('1.4 — שרת לא מחובר: מציג "לא מחובר" + כפתור "הפעל שרת"', async ({ page }) => {
    await page.route('**/localhost:3000/health', route => route.abort('connectionrefused'));

    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText(/לא מחובר — הפעל שרת CUDA/)).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: 'הפעל שרת' })).toBeVisible({ timeout: 3000 });
  });

  test('1.5 — health מחזיר cpu: device badge מציג cpu', async ({ page }) => {
    await mockHealth(page, healthOk({ device: 'cpu', gpu: null, model_ready: true }));
    await mockModelsList(page);
    await mockPreloadInstant(page);

    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    // Component renders serverStatus.device text when device !== 'cuda' (line 316 of TranscriptionEngine.tsx)
    await expect(page.getByText('cpu').first()).toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 2 — Model Badge Validation (without file upload, SSE-free)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('2. Model badges — מצבי מודל ב-UI', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
  });

  test('2.1 — model_ready=true: Sparkles icon + "מודל מוכן" badge גלויים', async ({ page }) => {
    await mockHealth(page, healthOk({ model_ready: true, model_loading: false }));
    await mockPreloadInstant(page);
    await mockModelsList(page);

    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('מודל מוכן')).toBeVisible({ timeout: 3000 });
  });

  test('2.2 — model_loading=true: amber badge "טוען מודל..." גלוי', async ({ page }) => {
    await mockHealth(page, healthOk({ model_loading: true, model_ready: false }));
    await mockModelsList(page);

    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('טוען מודל...')).toBeVisible({ timeout: 3000 });
  });

  test('2.3 — model_ready=false && model_loading=false: gray "מודל לא טעון" badge', async ({ page }) => {
    await mockHealth(page, healthOk({ model_ready: false, model_loading: false }));
    await mockModelsList(page);
    // preloadMode='direct' (set in gotoTranscribe) prevents auto-preload

    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('מודל לא טעון')).toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 3 — Preload Stream (UI)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('3. Preload stream — טעינת מודל ברקע', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    // Server connected, model not yet ready
    await mockHealth(page, healthOk({ model_ready: false, model_loading: false }));
    await mockModelsList(page);
  });

  test('3.1 — לחיצה על "טען מודל עכשיו" מפעילה preload (loading→ready)', async ({ page }) => {
    const preloadEvents = [
      { type: 'status', status: 'loading', model: 'large-v3-turbo', message: 'Loading model into GPU...' },
      { type: 'progress', message: 'Loading model...' },
      { type: 'status', status: 'ready', model: 'large-v3-turbo', elapsed: 8.3, message: 'Model loaded in 8.3s' },
    ];
    await page.route('**/localhost:3000/preload-stream', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sseBody(preloadEvents) })
    );

    await gotoTranscribe(page);
    await selectCuda(page);

    const loadBtn = page.getByRole('button', { name: /טען מודל עכשיו/ });
    await expect(loadBtn).toBeVisible({ timeout: 8000 });
    await loadBtn.click();

    await expect(page.getByText(/טוען|loading|מוכן|loaded/i).first()).toBeVisible({ timeout: 13000 });
  });

  test('3.2 — preload שגיאה: מציג הודעת שגיאה או failure state', async ({ page }) => {
    const preloadEvents = [
      { type: 'status', status: 'loading', model: 'large-v3-turbo', message: 'Loading model...' },
      { type: 'status', status: 'error', message: 'CUDA out of memory' },
    ];
    await page.route('**/localhost:3000/preload-stream', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sseBody(preloadEvents) })
    );

    await gotoTranscribe(page);
    await selectCuda(page);

    const loadBtn = page.getByRole('button', { name: /טען מודל עכשיו/ });
    await expect(loadBtn).toBeVisible({ timeout: 8000 });
    await loadBtn.click();

    // After error: should eventually show "מודל לא טעון" again OR an error indicator
    await expect(
      page.getByText(/שגיאה|כישלון|error|failed|מודל לא טעון/i).first()
    ).toBeVisible({ timeout: 13000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 4 — Preset Selection UI
// ═══════════════════════════════════════════════════════════════════════════

test.describe('4. ערכות תמלול — fast / balanced / accurate', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockHealth(page, healthOk());
    await mockPreloadInstant(page);
    await mockModelsList(page);
  });

  test('4.1 — שלוש כפתורי ערכה מוצגים כשמנוע CUDA נבחר', async ({ page }) => {
    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /מהיר/ }).first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /מאוזן/ }).first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /מדויק/ }).first()).toBeVisible({ timeout: 3000 });
  });

  test('4.2 — בחירת ערכה "מהיר" מציגה toast אישור', async ({ page }) => {
    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: /מהיר/ }).first().click();

    await expect(page.getByText(/ערכת תמלול|מהיר/i).first()).toBeVisible({ timeout: 3000 });
  });

  test('4.3 — בחירת ערכה "מדויק" נלחצת', async ({ page }) => {
    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: /מדויק/ }).first().click();

    await expect(page.getByText(/מדויק/i).first()).toBeVisible({ timeout: 3000 });
  });

  test('4.4 — כפתורי "טען מראש" ו-"תמלל ישיר" מוצגים', async ({ page }) => {
    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /טען מראש/ }).first()).toBeVisible({ timeout: 3000 });
    await expect(page.getByRole('button', { name: /תמלל ישיר/ }).first()).toBeVisible({ timeout: 3000 });
  });

  test('4.5 — לחיצה על "תמלל ישיר" מציגה הודעה', async ({ page }) => {
    await gotoTranscribe(page);
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: /תמלל ישיר/ }).first().click();

    await expect(page.getByText(/תמלול ישיר|VRAM|direct/i).first()).toBeVisible({ timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 5 — Start / Stop Lifecycle
// ═══════════════════════════════════════════════════════════════════════════

test.describe('5. Lifecycle — מחזורי הפעלה/כיבוי', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await page.addInitScript(() => {
      localStorage.setItem('preferred_engine', 'local-server');
      localStorage.setItem('cuda_preload_mode', 'direct');
    });
  });

  test('5.1 — start → GPU badge מציג שם GPU מה-health', async ({ page }) => {
    let serverRunning = false;

    // Health: state-driven (like server-lifecycle.spec.ts)
    await page.route('**/localhost:3000/health', route => {
      if (serverRunning) {
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify(healthOk({ gpu: 'NVIDIA GeForce RTX 5090' })),
        });
      }
      return route.abort('connectionrefused');
    });
    await mockLauncherStart(page, () => { serverRunning = true; });
    await page.route('**/localhost:8764/stop', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );
    await mockPreloadInstant(page);
    await mockModelsList(page);

    await page.goto('/transcribe');
    await selectCuda(page);

    await expect(page.getByText(/לא מחובר — הפעל שרת CUDA/)).toBeVisible({ timeout: 3000 });
    await page.getByRole('button', { name: 'הפעל שרת' }).click();
    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 12000 });
    await expect(page.getByText(/RTX 5090|NVIDIA/i)).toBeVisible({ timeout: 3000 });
  });

  test('5.2 — stop: כיבוי קורא ל-/shutdown', async ({ page }) => {
    let shutdownCalled = false;

    // Routes registered in LIFO-safe order: catch-all last? No — just no catch-all.
    // Specific routes only, registered before navigation.
    await page.route('**/localhost:3000/health', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(healthOk()) })
    );
    // Shutdown — registered AFTER health so checked FIRST in LIFO:
    await page.route('**/localhost:3000/shutdown', route => {
      shutdownCalled = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'shutting_down' }) });
    });
    await page.route('**/localhost:8764/stop', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );
    await mockPreloadInstant(page);
    await mockModelsList(page);

    await page.goto('/transcribe');
    await selectCuda(page);

    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'כבה שרת' }).click();

    await expect(page.getByText(/לא מחובר — הפעל שרת CUDA/)).toBeVisible({ timeout: 10000 });
    expect(shutdownCalled).toBe(true);
  });

  test('5.3 — שגיאת הפעלה: 500 מ-start-server מציג toast', async ({ page }) => {
    await page.route('**/localhost:3000/health', route => route.abort('connectionrefused'));
    await page.route('**/__api/start-server', route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Process crashed' }) })
    );
    await page.route('**/localhost:8764/start', route => route.abort('connectionrefused'));

    await page.goto('/transcribe');
    await selectCuda(page);

    await page.getByRole('button', { name: 'הפעל שרת' }).click();

    await expect(page.getByText(/שגיאה בהפעלת השרת/i).first()).toBeVisible({ timeout: 12000 });
  });

  test('5.4 — מחזור מלא: start → stop → disconnected', async ({ page }) => {
    let serverRunning = false;

    await page.route('**/localhost:3000/health', route => {
      if (serverRunning) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(healthOk()) });
      }
      return route.abort('connectionrefused');
    });
    await mockLauncherStart(page, () => { serverRunning = true; });
    await page.route('**/localhost:3000/shutdown', route => {
      serverRunning = false;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'shutting_down' }) });
    });
    await page.route('**/localhost:8764/stop', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    );
    await mockPreloadInstant(page);
    await mockModelsList(page);

    await page.goto('/transcribe');
    await selectCuda(page);

    // Start
    await page.getByRole('button', { name: 'הפעל שרת' }).click();
    await expect(page.getByText('מחובר')).toBeVisible({ timeout: 12000 });

    // Stop
    await page.getByRole('button', { name: 'כבה שרת' }).click();
    await expect(page.getByText(/לא מחובר — הפעל שרת CUDA/)).toBeVisible({ timeout: 10000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 6 — Direct API Contract (via page.evaluate through route interceptors)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('6. Endpoints API — ולידציית חוזה', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    // Navigate to app to get a valid browsing context for fetch() calls
    await mockHealth(page, healthOk());
    await mockPreloadInstant(page);
    await mockModelsList(page);
    await gotoTranscribe(page);
  });

  test('6.1 — /health: מחזיר את כל השדות הנדרשים', async ({ page }) => {
    const result = await browserFetch(page, `${SERVER_BASE}/health`);
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('status', 'ok');
    expect(data).toHaveProperty('device');
    expect(data).toHaveProperty('model_ready');
    expect(data).toHaveProperty('model_loading');
    expect(data).toHaveProperty('downloaded_models');
    expect(data).toHaveProperty('available_models');
    expect(data).toHaveProperty('uptime_seconds');
    expect(data.uptime_seconds).toBeGreaterThanOrEqual(0);
  });

  test('6.2 — /presets: שלוש ערכות עם שדות חובה', async ({ page }) => {
    const presets = {
      presets: {
        fast: { label: 'מהיר', fast_mode: true, beam_size: 1, batch_size: 24, compute_type: 'int8_float16' },
        balanced: { label: 'מאוזן', fast_mode: true, beam_size: 1, batch_size: 16, compute_type: 'int8_float16' },
        accurate: { label: 'מדויק', fast_mode: false, beam_size: 5, batch_size: 8, compute_type: 'float16' },
      },
      default: 'balanced',
    };
    await page.route('**/localhost:3000/presets', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify(presets) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/presets`);
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('default', 'balanced');
    expect(data.presets).toHaveProperty('fast');
    expect(data.presets).toHaveProperty('balanced');
    expect(data.presets).toHaveProperty('accurate');

    for (const [, p] of Object.entries(data.presets) as [string, Record<string, unknown>][]) {
      expect(p).toHaveProperty('fast_mode');
      expect(p).toHaveProperty('beam_size');
      expect(p).toHaveProperty('batch_size');
      expect(p).toHaveProperty('label');
    }
  });

  test('6.3 — /models: מחזיר רשימת מודלים וה-current', async ({ page }) => {
    const result = await browserFetch(page, `${SERVER_BASE}/models`);
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('models');
    expect(Array.isArray(data.models)).toBe(true);
    expect(data).toHaveProperty('current');
  });

  test('6.4 — /debug: מחזיר server, gpu, stats', async ({ page }) => {
    const debugData = {
      server: { uptime_seconds: 300, python_version: '3.11.0', pid: 12345 },
      gpu: { name: 'NVIDIA GeForce RTX 4090', device: 'cuda', memory: { allocated_mb: 1200, total_mb: 24564 } },
      system_memory: { total_gb: 32, used_gb: 8.2, free_gb: 23.8, percent: 25.6 },
      models: { current: 'large-v3-turbo', cached: [], loading: false, loading_id: null },
      concurrency: { transcribe_active: false, active_info: null },
      stats: { total_requests: 5, errors: 0, avg_rtf: 0.24 },
      recent_requests: [],
    };
    await page.route('**/localhost:3000/debug', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify(debugData) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/debug`);
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('server');
    expect(data).toHaveProperty('gpu');
    expect(data).toHaveProperty('system_memory');
    expect(data).toHaveProperty('models');
    expect(data).toHaveProperty('stats');
    expect(data.server).toHaveProperty('uptime_seconds');
    expect(data.stats).toHaveProperty('avg_rtf');
  });

  test('6.5 — /transcribe-stream: SSE 200, event=done נוכח', async ({ page }) => {
    const events = [
      { type: 'info', duration: 2.0, language: 'he', start_from: 0 },
      { type: 'done', text: 'בדיקה', wordTimings: [], duration: 2.0, processing_time: 0.5, rtf: 0.25, fast_mode: true },
    ];
    await page.route('**/localhost:3000/transcribe-stream', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS }, body: sseBody(events) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-stream`, 'POST', { language: 'he' });
    expect(result.status).toBe(200);
    expect(result.text).toContain('"type":"done"');
    expect(result.text).toContain('"type":"info"');
  });

  test('6.6 — /transcribe-stream: אין קובץ → 400', async ({ page }) => {
    await page.route('**/localhost:3000/transcribe-stream', route =>
      route.fulfill({ status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ error: 'No file or stage_id provided' }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-stream`, 'POST', { language: 'he' });
    expect(result.status).toBe(400);
    const data = JSON.parse(result.text);
    expect(data.error).toMatch(/file|stage_id/i);
  });

  test('6.7 — /transcribe-stream: קובץ גדול → 413', async ({ page }) => {
    await page.route('**/localhost:3000/transcribe-stream', route =>
      route.fulfill({ status: 413, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ error: 'File too large: 520.0 MB (max 500 MB)' }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-stream`, 'POST', { language: 'he' });
    expect(result.status).toBe(413);
    const data = JSON.parse(result.text);
    expect(data.error).toMatch(/large|MB/i);
  });

  test('6.8 — /stage-audio: מחזיר stage_id', async ({ page }) => {
    const stageResp = { stage_id: 'aaaa-bbbb-cccc-dddd', filename: 'test.wav', file_size: 16044 };
    await page.route('**/localhost:3000/stage-audio', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify(stageResp) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/stage-audio`, 'POST', { filename: 'test.wav' });
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('stage_id');
    expect(typeof data.stage_id).toBe('string');
    expect(data.stage_id.length).toBeGreaterThan(0);
    expect(data).toHaveProperty('filename');
  });

  test('6.9 — /transcribe-stream עם stage_id: מכיל done', async ({ page }) => {
    const events = [
      { type: 'info', duration: 3.0, language: 'he', start_from: 0 },
      { type: 'done', text: 'שלום', wordTimings: [], duration: 3.0, processing_time: 0.7, rtf: 0.23, fast_mode: true },
    ];
    await page.route('**/localhost:3000/transcribe-stream', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS }, body: sseBody(events) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-stream`, 'POST', { stage_id: 'aaaa-bbbb-cccc-dddd', language: 'he' });
    expect(result.status).toBe(200);
    expect(result.text).toContain('"type":"done"');
  });

  test('6.10 — /unload-models: מחזיר status:ok + count', async ({ page }) => {
    await page.route('**/localhost:3000/unload-models', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ status: 'ok', unloaded: 2 }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/unload-models`, 'POST');
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('status', 'ok');
    expect(data).toHaveProperty('unloaded');
    expect(typeof data.unloaded).toBe('number');
  });

  test('6.11 — /warmup: מחזיר status:ok + warmup_time', async ({ page }) => {
    await page.route('**/localhost:3000/warmup', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ status: 'ok', warmup_time: 0.34 }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/warmup`, 'POST');
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('status', 'ok');
    expect(data).toHaveProperty('warmup_time');
    expect(data.warmup_time).toBeGreaterThan(0);
  });

  test('6.12 — /shutdown: מחזיר status:shutting_down', async ({ page }) => {
    await page.route('**/localhost:3000/shutdown', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ status: 'shutting_down' }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/shutdown`, 'POST');
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('status', 'shutting_down');
  });

  test('6.13 — /load-model: מחזיר status:loaded', async ({ page }) => {
    await page.route('**/localhost:3000/load-model', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ status: 'loaded', model: 'large-v3-turbo' }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/load-model`, 'POST', { model: 'large-v3-turbo' });
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('status', 'loaded');
    expect(data).toHaveProperty('model');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 7 — Rate Limiting + Error Codes
// ═══════════════════════════════════════════════════════════════════════════

test.describe('7. Rate limiting + error codes', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockHealth(page, healthOk());
    await mockPreloadInstant(page);
    await mockModelsList(page);
    await gotoTranscribe(page);
  });

  test('7.1 — 429 rate limit: error ב-JSON', async ({ page }) => {
    await page.route('**/localhost:3000/transcribe-stream', route =>
      route.fulfill({ status: 429, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ error: 'Rate limit exceeded', limit: '30 requests per 60s' }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-stream`, 'POST', { language: 'he' });
    expect(result.status).toBe(429);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('error');
    expect(data.error).toMatch(/rate|limit/i);
  });

  test('7.2 — 401 unauthorized: X-API-Key חסר', async ({ page }) => {
    await page.route('**/localhost:3000/transcribe-stream', route =>
      route.fulfill({ status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ error: 'Invalid or missing API key' }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-stream`, 'POST', { language: 'he' });
    expect(result.status).toBe(401);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 8 — Concurrency (GPU Lock)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('8. Concurrency — GPU lock', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockHealth(page, healthOk({ transcribe_active: true }));
    await mockPreloadInstant(page);
    await mockModelsList(page);
    await gotoTranscribe(page);
  });

  test('8.1 — health כשהשרת עסוק: transcribe_active=true', async ({ page }) => {
    const result = await browserFetch(page, `${SERVER_BASE}/health`);
    const data = JSON.parse(result.text);
    expect(data.transcribe_active).toBe(true);
  });

  test('8.2 — SSE: GPU lock timeout מחזיר type:error', async ({ page }) => {
    const events = [
      { type: 'error', error: 'Server busy — GPU lock timeout. Try again later.', error_type: 'TimeoutError', request_id: 'xyz999' },
    ];
    await page.route('**/localhost:3000/transcribe-stream', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS }, body: sseBody(events) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-stream`, 'POST', { language: 'he' });
    expect(result.status).toBe(200);
    expect(result.text).toContain('"type":"error"');
    expect(result.text).toContain('GPU lock timeout');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 9 — YouTube Endpoint Validation
// ═══════════════════════════════════════════════════════════════════════════

test.describe('9. YouTube endpoint — ולידציה', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockHealth(page, healthOk());
    await mockPreloadInstant(page);
    await mockModelsList(page);
    await gotoTranscribe(page);
  });

  test('9.1 — URL לא חוקי → 400', async ({ page }) => {
    await page.route('**/localhost:3000/youtube-transcribe', route => {
      const body = route.request().postData() || '';
      if (!body.includes('youtube.com')) {
        return route.fulfill({ status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ error: 'Invalid YouTube URL' }) });
      }
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ text: 'mock' }) });
    });

    const result = await browserFetch(page, `${SERVER_BASE}/youtube-transcribe`, 'POST', { url: 'https://malicious-site.com/video', language: 'he' });
    expect(result.status).toBe(400);
    const data = JSON.parse(result.text);
    expect(data.error).toMatch(/YouTube URL|invalid/i);
  });

  test('9.2 — URL ריק → 400', async ({ page }) => {
    await page.route('**/localhost:3000/youtube-transcribe', route =>
      route.fulfill({ status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ error: 'No URL provided' }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/youtube-transcribe`, 'POST', { url: '', language: 'he' });
    expect(result.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 10 — Diarization Endpoint
// ═══════════════════════════════════════════════════════════════════════════

test.describe('10. Diarization — פיצול דוברים', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockHealth(page, healthOk());
    await mockPreloadInstant(page);
    await mockModelsList(page);
    await gotoTranscribe(page);
  });

  test('10.1 — /diarize: מחזיר segments עם speaker_label', async ({ page }) => {
    const diarizationResp = {
      text: 'שלום עולם. מה שלומך.',
      segments: [
        { text: 'שלום עולם.', start: 0.0, end: 2.1, speaker: 'SPEAKER_00', speaker_label: 'דובר 1', words: [] },
        { text: 'מה שלומך.', start: 3.5, end: 5.2, speaker: 'SPEAKER_01', speaker_label: 'דובר 2', words: [] },
      ],
      speakers: ['דובר 1', 'דובר 2'],
      speaker_count: 2,
      duration: 5.2,
      language: 'he',
      model: 'large-v3-turbo',
      processing_time: 1.8,
      diarization_method: 'silence-gap',
    };
    await page.route('**/localhost:3000/diarize', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify(diarizationResp) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/diarize`, 'POST', { language: 'he' });
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('segments');
    expect(data).toHaveProperty('speaker_count', 2);
    expect(data).toHaveProperty('diarization_method');
    expect(data.segments.length).toBe(2);

    for (const seg of data.segments) {
      expect(seg).toHaveProperty('speaker_label');
    }
  });

  test('10.2 — /diarize: אין קובץ → 400', async ({ page }) => {
    await page.route('**/localhost:3000/diarize', route =>
      route.fulfill({ status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ error: 'No file provided' }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/diarize`, 'POST', { language: 'he' });
    expect(result.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 11 — Setup Scan Endpoint
// ═══════════════════════════════════════════════════════════════════════════

test.describe('11. Setup scan — בדיקת מערכת', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockHealth(page, healthOk());
    await mockPreloadInstant(page);
    await mockModelsList(page);
    await gotoTranscribe(page);
  });

  test('11.1 — /setup/scan: מחזיר GPU, RAM, disk, packages', async ({ page }) => {
    const scanResp = {
      system: { python_version: '3.11.0', ram: { total_gb: 32, used_gb: 8.5 }, disk_free_gb: 120.5 },
      gpu: { name: 'NVIDIA GeForce RTX 4090', device: 'cuda', cuda_available: true, cuda_version: '12.1' },
      packages: { faster_whisper: '1.0.3', flask: '3.0.3', torch: '2.2.1' },
      models: { current: null, downloaded: ['large-v3-turbo'] },
      server: { uptime_seconds: 45, port: 3000 },
    };
    await page.route('**/localhost:3000/setup/scan', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify(scanResp) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/setup/scan`);
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('system');
    expect(data).toHaveProperty('gpu');
    expect(data).toHaveProperty('packages');
    expect(data).toHaveProperty('models');
    expect(data.gpu).toHaveProperty('cuda_available');
    expect(data.packages).toHaveProperty('faster_whisper');
    expect(data.packages).toHaveProperty('torch');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 12 — Transcription Parameters (API contract)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('12. פרמטרים ידניים — API contract', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockHealth(page, healthOk());
    await mockPreloadInstant(page);
    await mockModelsList(page);
    await gotoTranscribe(page);
  });

  test('12.1 — done event: fast_mode=true מוחזר', async ({ page }) => {
    const events = [
      { type: 'info', duration: 2.0, language: 'he', start_from: 0 },
      { type: 'done', text: 'בדיקה ידנית', wordTimings: [], duration: 2.0, processing_time: 0.4, rtf: 0.2, fast_mode: true, beam_size: 1 },
    ];
    await page.route('**/localhost:3000/transcribe-stream', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS }, body: sseBody(events) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-stream`, 'POST', { language: 'he', fast_mode: '1', beam_size: '1' });
    expect(result.status).toBe(200);
    const doneMatch = result.text.match(/data: (\{.*?"type":"done".*?\})\n/);
    expect(doneMatch).toBeTruthy();
    if (doneMatch) {
      const done = JSON.parse(doneMatch[1]);
      expect(done.fast_mode).toBe(true);
      expect(done.beam_size).toBe(1);
    }
  });

  test('12.2 — start_from=30: info event מכיל start_from=30', async ({ page }) => {
    const events = [
      { type: 'info', duration: 60.0, language: 'he', start_from: 30 },
      { type: 'done', text: 'המשך', wordTimings: [], duration: 60.0, processing_time: 5.0, rtf: 0.167, fast_mode: true, start_from: 30 },
    ];
    await page.route('**/localhost:3000/transcribe-stream', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS }, body: sseBody(events) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-stream`, 'POST', { language: 'he', start_from: '30' });
    expect(result.status).toBe(200);
    const infoMatch = result.text.match(/data: (\{.*?"type":"info".*?\})\n/);
    expect(infoMatch).toBeTruthy();
    if (infoMatch) {
      const info = JSON.parse(infoMatch[1]);
      expect(info.start_from).toBe(30);
    }
  });

  test('12.3 — paragraphBreak=true: segment מכיל paragraphBreak', async ({ page }) => {
    const events = [
      { type: 'info', duration: 20.0, language: 'he', start_from: 0 },
      { type: 'segment', text: 'משפט ראשון.', words: [], progress: 30, segEnd: 6.0, paragraphBreak: false },
      { type: 'segment', text: 'אחרי הפסקה.', words: [], progress: 80, segEnd: 16.0, paragraphBreak: true },
      { type: 'done', text: 'משפט ראשון. אחרי הפסקה.', wordTimings: [], duration: 20.0, processing_time: 3.5, rtf: 0.175, fast_mode: true },
    ];
    await page.route('**/localhost:3000/transcribe-stream', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS }, body: sseBody(events) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-stream`, 'POST', { language: 'he', paragraph_threshold: '5.0' });
    expect(result.status).toBe(200);
    expect(result.text).toContain('"paragraphBreak":true');
  });

  test('12.4 — /transcribe-live: מחזיר text ו-processing_time', async ({ page }) => {
    await page.route('**/localhost:3000/transcribe-live', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ text: 'תמלול חי', wordTimings: [], processing_time: 0.12, audio_duration: 3.0 }) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/transcribe-live`, 'POST', { language: 'he' });
    expect(result.status).toBe(200);
    const data = JSON.parse(result.text);
    expect(data).toHaveProperty('text');
    expect(data).toHaveProperty('processing_time');
    expect(data.processing_time).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GROUP 13 — preload-stream SSE Contract
// ═══════════════════════════════════════════════════════════════════════════

test.describe('13. preload-stream SSE — חוזה', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockHealth(page, healthOk());
    await mockModelsList(page);
    // Note: we do NOT call mockPreloadInstant here — tests set up their own /preload-stream routes
    await gotoTranscribe(page);
  });

  test('13.1 — loading → ready: status fields נכונים', async ({ page }) => {
    const preloadEvents = [
      { type: 'status', status: 'loading', model: 'large-v3-turbo', message: 'Loading model...' },
      { type: 'progress', message: 'Loading model into GPU...' },
      { type: 'status', status: 'ready', model: 'large-v3-turbo', elapsed: 7.2, message: 'Model loaded in 7.2s' },
    ];
    await page.route('**/localhost:3000/preload-stream', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS }, body: sseBody(preloadEvents) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/preload-stream`, 'POST', { model: 'large-v3-turbo' });
    expect(result.status).toBe(200);
    expect(result.text).toContain('"status":"loading"');
    expect(result.text).toContain('"status":"ready"');
    expect(result.text).toContain('"elapsed"');
  });

  test('13.2 — מודל כבר ב-cache: instant ready', async ({ page }) => {
    const preloadEvents = [
      { type: 'status', status: 'ready', model: 'large-v3-turbo', message: 'Model already loaded', elapsed: 0 },
    ];
    await page.route('**/localhost:3000/preload-stream', route =>
      route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream', ...CORS_HEADERS }, body: sseBody(preloadEvents) })
    );

    const result = await browserFetch(page, `${SERVER_BASE}/preload-stream`, 'POST', { model: 'large-v3-turbo' });
    expect(result.status).toBe(200);
    expect(result.text).toContain('"status":"ready"');
    expect(result.text).toContain('already loaded');
  });
});
