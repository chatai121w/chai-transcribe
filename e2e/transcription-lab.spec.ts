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
    await expect(page.getByRole('heading', { name: 'מעבדת תמלול מתקדמת' })).toBeVisible({ timeout: 120_000 });
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

    await expect(page).toHaveURL(/\/transcription-lab\?mode=lashon-kodesh/, { timeout: 120_000 });
    await expect(page.getByRole('heading', { name: 'מעבדת תמלול מתקדמת' })).toBeVisible({ timeout: 120_000 });
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

  test('loads verified editor text with the existing cloud audio and does not upload it again', async ({ page }) => {
    const storageUploads: string[] = [];
    page.on('request', request => {
      const url = request.url();
      if (request.method() === 'POST'
          && url.includes('/storage/v1/object/permanent-audio/')) {
        storageUploads.push(url);
      }
    });
    await page.addInitScript(() => {
      window.history.replaceState({
        usr: {
          source: 'verified-text-editor',
          sourceTranscriptId: 'tr-002',
          audioFilePath: 'test-audio.webm',
          audioFileName: 'שיעור-מאומת.wav',
          initialTranscript: 'אמר רבי עקיבה',
          groundTruth: 'אמר רבי עקיבא',
        },
        key: 'verified-transfer',
        idx: 0,
      }, '', window.location.href);
    });

    await page.goto('/transcription-lab', { waitUntil: 'commit' });

    await expect(page.getByRole('heading', { name: 'מעבדת תמלול מתקדמת' })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('האודיו וטקסט האמת נטענו מהתמלול המאומת', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('מקור מקושר מעורך הטקסט', { exact: true })).toBeVisible();
    await expect(page.getByText(/שיעור-מאומת\.wav/)).toBeVisible();
    await expect(page.locator('#ground-truth')).toHaveValue('אמר רבי עקיבא');
    await expect(page.locator('#initial-transcript')).toHaveValue('אמר רבי עקיבה');
    await expect(page.getByRole('button', { name: 'הפעל ניסוי מלא' })).toBeEnabled();
    expect(storageUploads).toEqual([]);

    const sourceEvent = await page.evaluate(() => {
      const events = JSON.parse(localStorage.getItem('asr_pipeline_events_v1') || '[]') as Array<{
        eventType: string;
        details?: { audioUploadedAgain?: boolean; transcriptId?: string };
      }>;
      return events.find(event => event.eventType === 'verified-editor-source-linked');
    });
    expect(sourceEvent?.details).toMatchObject({ audioUploadedAgain: false, transcriptId: 'tr-002' });
  });

  test('approves the edited text in the editor and opens the central lab with the same recording', async ({ page }) => {
    const transcriptWrites: Array<{ method: string; url: string; body: string | null }> = [];
    const storageUploads: string[] = [];
    page.on('request', request => {
      const url = request.url();
      if (url.includes('/rest/v1/transcripts') || url.includes('/rest/v1/transcript_versions')) {
        transcriptWrites.push({ method: request.method(), url, body: request.postData() });
      }
      if (request.method() === 'POST' && url.includes('/storage/v1/object/permanent-audio/')) {
        storageUploads.push(url);
      }
    });
    await page.addInitScript(() => {
      window.history.replaceState({
        usr: {
          transcriptId: 'tr-002',
          text: 'אמר רבי עקיבא',
          engine: 'Local CUDA',
          engineLabel: 'Ivrit.ai Turbo V3',
          audioFilePath: 'test-audio.webm',
          audioFileName: 'שיעור-מאומת.wav',
          initialTab: 'player',
        },
        key: 'editor-source',
        idx: 0,
      }, '', window.location.href);
    });

    await page.goto('/text-editor', { waitUntil: 'commit' });
    const transfer = page.getByLabel('העברה למעבדת התמלול');
    await expect(transfer).toBeVisible({ timeout: 120_000 });
    await expect(transfer.getByText('אודיו מקושר', { exact: true })).toBeVisible();
    await transfer.getByRole('button', { name: 'אשר והעבר למעבדה' }).click();

    await expect(page).toHaveURL(/\/transcription-lab$/, { timeout: 30_000 });
    await expect(page.locator('#ground-truth')).toHaveValue('אמר רבי עקיבא', { timeout: 30_000 });
    await expect(page.locator('#initial-transcript')).toHaveValue('תמלול שני לבדיקת המערכת');
    await expect(page.getByText('מקור מקושר מעורך הטקסט', { exact: true })).toBeVisible();
    expect(storageUploads).toEqual([]);
    expect(transcriptWrites.some(write => write.method === 'PATCH' && write.body?.includes('"edited_text":"אמר רבי עקיבא"'))).toBe(true);
    expect(transcriptWrites.some(write => write.url.includes('/transcript_versions') && write.body?.includes('טקסט אמת מאומת'))).toBe(true);
  });

  test('records a terminology sample and prepares the existing A/B pipeline automatically', async ({ page }) => {
    await page.addInitScript(() => {
      const fakeTrack = { stop: () => undefined };
      const fakeStream = { getTracks: () => [fakeTrack] };
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => fakeStream },
      });

      class FakeMediaRecorder {
        static isTypeSupported = () => true;
        state = 'inactive';
        mimeType = 'audio/webm;codecs=opus';
        ondataavailable: ((event: { data: Blob }) => void) | null = null;
        onstop: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor(_stream: unknown, options?: { mimeType?: string }) {
          if (options?.mimeType) this.mimeType = options.mimeType;
        }
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          this.ondataavailable?.({ data: new Blob(['fake-microphone-audio'], { type: this.mimeType }) });
          this.onstop?.();
        }
      }
      Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: FakeMediaRecorder });
    });

    await page.goto('/transcription-lab', { waitUntil: 'commit' });
    const recorder = page.getByLabel('הקלטת בדיקת מושגים');
    await recorder.getByLabel('מושגים לבדיקה').fill('אביי, רבא, מסכת בבא קמא');
    await recorder.getByRole('button', { name: 'הכן טקסט' }).click();
    await expect(recorder.getByLabel('טקסט מדויק להקראה')).toContainText('אביי, רבא, מסכת בבא קמא');

    await recorder.getByRole('button', { name: 'התחל הקלטת בדיקת מושגים' }).click();
    await expect(recorder.getByText('00:00')).toBeVisible();
    await recorder.getByRole('button', { name: 'סיים והעלה לניסוי' }).click();

    await expect(page.getByText('הקלטת המושגים מוכנה לניסוי', { exact: true })).toBeVisible();
    await expect(page.getByText(/torah-terms-.*\.webm/)).toBeVisible();
    await expect(page.locator('#ground-truth')).toHaveValue('אני קורא כעת את המושגים הבאים: אביי, רבא, מסכת בבא קמא.');
    await expect(page.locator('#manual-hotwords')).toHaveValue('אביי, רבא, מסכת בבא קמא');
    await expect(page.getByRole('button', { name: 'הפעל ניסוי מלא' })).toBeEnabled();
    await expect(recorder.getByText('הקלטה אחרונה')).toBeVisible();
  });
});
