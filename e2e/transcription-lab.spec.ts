import { expect, injectAuthSession, mockSupabase, test } from './helpers';

test.describe('Unified transcription lab', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
      status: 200,
      contentType: 'text/css',
      body: '',
    }));
    await mockSupabase(page);
    await injectAuthSession(page);
  });

  test('runs A/B, records every material stage, and keeps the audit after refresh', async ({ page }) => {
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    let transcriptionCall = 0;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('requestfailed', request => {
      const url = request.url();
      const isApiRequest = request.resourceType() === 'fetch' || request.resourceType() === 'xhr';
      if (isApiRequest && !url.includes('/realtime/') && !url.includes('/rnnoise-wasm/')) failedRequests.push(url);
    });
    const handleTranscription = async (route: Parameters<Parameters<typeof page.route>[1]>[0]) => {
      transcriptionCall += 1;
      await route.fulfill({
        status: 200,
        json: {
          text: transcriptionCall === 1 ? 'אמר רבי עקיבה' : 'אמר רבי עקיבא',
          language: 'he',
          model: 'ivrit-ai/whisper-large-v3-turbo-ct2',
          word_timings: [],
        },
      });
    };
    await page.route('**/whisper/transcribe', handleTranscription);

    await page.goto('/transcription-lab', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: 'מעבדת תמלול מתקדמת' })).toBeVisible();
    await page.locator('#lab-audio').setInputFiles({
      name: 'shiur-test.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.from('RIFF-test-audio'),
    });
    await page.locator('#ground-truth').fill('אמר רבי עקיבא');
    await page.getByRole('button', { name: 'הפעל ניסוי מלא' }).click();

    await expect(page.getByLabel('השוואה ושער איכות').getByText('נמצא שיפור', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('הניסוי הושלם', { exact: true })).toBeVisible();

    const audit = await page.evaluate(() => {
      const id = localStorage.getItem('asr_pipeline_active_experiment_v1');
      const events = JSON.parse(localStorage.getItem('asr_pipeline_events_v1') || '[]') as Array<{
        experimentId: string;
        stage: string;
        eventType: string;
        details: Record<string, unknown>;
      }>;
      const current = events.filter(event => event.experimentId === id);
      return {
        id,
        count: current.length,
        stages: [...new Set(current.map(event => event.stage))],
        hasReasons: current.some(event => typeof event.details.reason === 'string'),
      };
    });

    expect(audit.id).toBeTruthy();
    expect(audit.count).toBeGreaterThanOrEqual(15);
    expect(audit.stages).toEqual(expect.arrayContaining([
      'source', 'configuration', 'upload', 'transcription', 'knowledge',
      'metrics', 'quality-gate', 'review', 'complete',
    ]));
    expect(audit.hasReasons).toBe(true);

    await page.reload({ waitUntil: 'commit' });
    await expect(page.getByText(new RegExp(`${audit.count} אירועים בריצה זו`))).toBeVisible();
    await expect(page.getByText('מדדי האיכות חושבו מול טקסט האמת').first()).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test('is readable in RTL mobile layout and legacy routes use the same lab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/lashon-kodesh', { waitUntil: 'commit' });

    await expect(page).toHaveURL(/\/transcription-lab\?mode=lashon-kodesh/);
    await expect(page.getByRole('heading', { name: 'מעבדת תמלול מתקדמת' })).toBeVisible();
    await expect(page.getByLabel('הפעל מצב לשון הקודש בריצה B')).toBeChecked();
    const layout = await page.evaluate(() => ({
      direction: getComputedStyle(document.querySelector('main')!).direction,
      viewportWidth: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.direction).toBe('rtl');
    expect(layout.contentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  });

  test('offers Gemini 3.5 Transcribe as an A/B engine model', async ({ page }) => {
    await page.goto('/transcription-lab', { waitUntil: 'commit' });
    await page.getByRole('combobox', { name: 'מנוע B - מועמד' }).click();
    await page.getByRole('option', { name: 'Gemini' }).click();
    await expect(page.getByRole('combobox', { name: 'מודל B' })).toContainText('Gemini 3.5 Transcribe');
  });
});
