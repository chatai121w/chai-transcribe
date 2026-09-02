import { expect, injectAuthSession, mockSupabase, test } from './helpers';

function silentWav(durationSeconds = 2, sampleRate = 16_000): Buffer {
  const samples = Math.floor(durationSeconds * sampleRate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

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
    const approvedAudioBodies: string[] = [];
    const cloudAudioUploads: string[] = [];
    const cloudTranscriptCreates: string[] = [];
    let transcriptionCall = 0;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') console.log(`[browser] ${message.text()}`);
    });
    page.on('requestfailed', request => {
      const url = request.url();
      const isApiRequest = request.resourceType() === 'fetch' || request.resourceType() === 'xhr';
      if (isApiRequest && !url.includes('/realtime/') && !url.includes('/rnnoise-wasm/')) failedRequests.push(url);
    });
    page.on('request', request => {
      const url = request.url();
      if (request.method() === 'POST' && url.includes('/storage/v1/object/permanent-audio/')) cloudAudioUploads.push(url);
      if (request.method() === 'POST' && url.includes('/rest/v1/transcripts')) cloudTranscriptCreates.push(request.postData() || '');
    });
    const handleTranscription = async (route: Parameters<Parameters<typeof page.route>[1]>[0]) => {
      transcriptionCall += 1;
      await route.fulfill({
        status: 200,
        json: {
          text: transcriptionCall === 1 ? 'אמר רבי עקיבה' : 'אמר רבי עקיבא',
          language: 'he',
          model: 'ivrit-ai/whisper-large-v3-turbo-ct2',
          word_timings: [
            { word: 'אמר', start: 0, end: 0.4 },
            { word: 'רבי', start: 0.4, end: 0.8 },
            { word: transcriptionCall === 1 ? 'עקיבה' : 'עקיבא', start: 0.8, end: 1.8 },
          ],
        },
      });
    };
    await page.route('**/whisper/transcribe', handleTranscription);
    await page.route('**/training/dataset/approved-pair', route => {
      approvedAudioBodies.push(route.request().postDataBuffer()?.toString('latin1') || '');
      return route.fulfill({ status: 200, json: { rows: 1 } });
    });

    await page.goto('/transcription-lab', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: 'מעבדת תמלול מתקדמת' })).toBeVisible({ timeout: 120_000 });
    await page.locator('#lab-audio').setInputFiles({
      name: 'shiur-test.m4a',
      mimeType: 'audio/mp4',
      buffer: silentWav(),
    });
    await page.locator('#ground-truth').fill('אמר רבי עקיבא');
    await page.getByRole('button', { name: 'הפעל ניסוי מלא' }).click();

    await expect(page.getByLabel('השוואה ושער איכות').getByText('נמצא שיפור', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('הניסוי הושלם', { exact: true })).toBeVisible();
    await expect(page.getByTestId('ground-truth-diff-a').locator('[data-diff="changed"]')).toHaveCount(1);
    await expect(page.getByTestId('ground-truth-diff-b').locator('[data-diff="changed"]')).toHaveCount(0);

    await page.getByRole('button', { name: 'בחר התאמות B' }).click();
    await expect(page.getByText('3 יחידות נבחרו', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'שמור B כנכון למסומנים' }).click();
    await expect(page.getByText('הבחירה המרובה נשמרה', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'נקה' }).click();

    await page.getByTestId('asr-review-unit-2').click();
    await expect(page.getByTestId('asr-review-decision-panel')).toBeVisible();
    await page.getByTestId('asr-review-decision-panel').getByRole('button', { name: /מנוע B נכון/ }).click();
    await page.getByRole('button', { name: 'שמור Human Review' }).click();
    await expect(page.getByText('הבדיקה האנושית נשמרה', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'אשר קטע ל-Gold' }).click();
    await expect(page.getByText('הקטע אושר ל-Gold', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'אשר את כל ההקלטה וטקסט האמת ל-Gold' }).click();
    await expect(page.getByText('כל קטעי ה-Gold נשמרו', { exact: true })).toBeVisible({ timeout: 15_000 });

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
        hasHumanReview: current.some(event => event.eventType === 'human-review-saved'),
        hasTimedGold: current.some(event => event.eventType === 'human-review-gold-approved'),
        hasFullGold: current.some(event => event.eventType === 'gold-approved' && Number(event.details.segments) > 0),
        cloudSaved: current.some(event => event.eventType === 'gold-approved'
          && event.details.cloudSaved === true
          && typeof event.details.cloudTranscriptId === 'string'
          && typeof event.details.audioFilePath === 'string'),
      };
    });

    expect(audit.id).toBeTruthy();
    expect(audit.count).toBeGreaterThanOrEqual(15);
    expect(audit.stages).toEqual(expect.arrayContaining([
      'source', 'configuration', 'upload', 'transcription', 'knowledge',
      'metrics', 'quality-gate', 'review', 'complete',
    ]));
    expect(audit.hasReasons).toBe(true);
    expect(audit.hasHumanReview).toBe(true);
    expect(audit.hasTimedGold).toBe(true);
    expect(audit.hasFullGold).toBe(true);
    expect(audit.cloudSaved).toBe(true);
    expect(approvedAudioBodies).toHaveLength(2);
    expect(approvedAudioBodies.every(body => /filename="[^"]+\.wav"/.test(body) && body.includes('RIFF'))).toBe(true);
    expect(cloudAudioUploads).toHaveLength(1);
    expect(cloudTranscriptCreates.filter(body => body.includes('asr-gold-source'))).toHaveLength(0);
    expect(cloudTranscriptCreates.filter(body => body.includes('Gold ·'))).toHaveLength(1);

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
      overflowers: Array.from(document.querySelectorAll<HTMLElement>('body *')).map((element) => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, text: element.innerText?.slice(0, 50), left: rect.left, right: rect.right, width: rect.width, classes: element.className, insideFixed: Boolean(element.closest('.fixed')) };
      }).filter((item) => item.right > window.innerWidth + 1 || item.left < -1).filter((item) => !item.insideFixed).slice(0, 30),
    }));
    expect(layout.direction).toBe('rtl');
    expect(layout.contentWidth, JSON.stringify(layout.overflowers, null, 2)).toBeLessThanOrEqual(layout.viewportWidth + 1);
  });

  test('offers Gemini 3.5 Transcribe as an A/B engine model', async ({ page }) => {
    await page.goto('/transcription-lab', { waitUntil: 'commit' });
    await page.getByRole('combobox', { name: 'מנוע B - מועמד' }).click();
    await page.getByRole('option', { name: 'Gemini' }).click();
    await expect(page.getByRole('combobox', { name: 'מודל B' })).toContainText('Gemini 3.5 Transcribe');
  });

  test('selects an existing site recording from the shared folder tree without treating unverified text as Gold', async ({ page }) => {
    const storageUploads: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/storage/v1/object/permanent-audio/')) {
        storageUploads.push(request.url());
      }
    });

    await page.goto('/transcription-lab', { waitUntil: 'commit' });
    await page.getByRole('button', { name: 'בחר מהתיקיות' }).click();

    const dialog = page.getByTestId('comparison-source-dialog');
    await expect(dialog.getByRole('heading', { name: 'בחירת הקלטה למעבדת התמלול' })).toBeVisible();
    await expect(dialog.getByText('תמלול בדיקה 1', { exact: true })).toHaveCount(0);
    await dialog.getByText('תמלול בדיקה 2', { exact: true }).click();

    await expect(page.getByText('מקור מקושר מהמערכת', { exact: true })).toBeVisible();
    await expect(page.getByText('ההקלטה נטענה; הטקסט הקיים דורש אימות', { exact: true })).toBeVisible();
    await expect(page.locator('#initial-transcript')).toHaveValue('תמלול שני לבדיקת המערכת');
    await expect(page.locator('#ground-truth')).toHaveValue('');
    await expect(page.getByText('תמלול בדיקה 2.webm · 0.0 MB', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'הפעל ניסוי מלא' })).toBeEnabled();
    expect(storageUploads).toEqual([]);
  });

  test('applies a human-verified dictionary correction on a repeated run of the same recording', async ({ page }) => {
    let call = 0;
    await page.route('**/whisper/transcribe', async route => {
      call += 1;
      const text = call % 2 === 1 ? 'ארומך אלוהי מלך' : 'ארומך אלוהי המלך';
      await route.fulfill({
        status: 200,
        json: {
          text,
          language: 'he',
          model: 'ivrit-ai/whisper-large-v3-turbo-ct2',
          word_timings: text.split(' ').map((word, index) => ({ word, start: index * 0.5, end: (index + 1) * 0.5 })),
        },
      });
    });

    await page.goto('/transcription-lab', { waitUntil: 'commit' });
    await page.locator('#lab-audio').setInputFiles({
      name: 'arumemcha.wav',
      mimeType: 'audio/wav',
      buffer: silentWav(2),
    });
    await page.locator('#ground-truth').fill('ארוממך אלוהי המלך');
    await page.getByRole('button', { name: 'הפעל ניסוי מלא' }).click();
    await expect(page.getByText('הניסוי הושלם', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ground-truth-diff-b').locator('[data-diff="changed"]')).toHaveCount(1);

    await page.getByTestId('asr-review-unit-0').click();
    const decision = page.getByTestId('asr-review-decision-panel');
    await decision.getByRole('button', { name: /טקסט האמת נכון/ }).click();
    await decision.getByRole('button', { name: 'שמור Human Review' }).click();
    await decision.getByRole('button', { name: 'אשר והפעל במילון' }).click();
    await expect(page.getByText('התיקון אומת והופעל', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'הפעל ניסוי מלא' }).click();
    await expect(page.getByText('הניסוי הושלם', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('ground-truth-diff-b').locator('[data-diff="changed"]')).toHaveCount(0);
    await expect(page.getByTestId('ground-truth-diff-b')).toContainText('ארוממך');

    const eventExists = await page.evaluate(() => {
      const events = JSON.parse(localStorage.getItem('asr_pipeline_events_v1') || '[]') as Array<{ eventType: string }>;
      return events.some(event => event.eventType === 'verified-correction-activated');
    });
    expect(eventExists).toBe(true);
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
    await expect(page.getByText('מקור מקושר מהמערכת', { exact: true })).toBeVisible();
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

  test('loads a saved Gold recording and its verified text for a repeated experiment', async ({ page }) => {
    await page.route('**/rest/v1/transcripts*', async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      const now = new Date().toISOString();
      return route.fulfill({
        status: 200,
        json: [{
          id: 'gold-source-1',
          user_id: 'test-user-id',
          text: 'ארוממך אלוהי המלך',
          edited_text: 'ארוממך אלוהי המלך',
          engine: 'Gold · Local CUDA',
          title: 'Gold · fingerprint-1 · torah-sample.wav',
          tags: ['asr-gold-source', 'human-approved'],
          notes: '', folder: 'מעבדת תמלול', category: '', is_favorite: false,
          audio_file_path: 'test-audio.webm',
          word_timings: null,
          created_at: now,
          updated_at: now,
        }],
      });
    });

    await page.goto('/transcription-lab', { waitUntil: 'commit' });
    const cloudSources = page.getByLabel('הקלטות Gold בענן');
    await expect(cloudSources).toBeVisible({ timeout: 30_000 });
    await cloudSources.getByRole('button', { name: 'טען לניסוי חוזר' }).click();

    await expect(page.locator('#ground-truth')).toHaveValue('ארוממך אלוהי המלך');
    await expect(page.getByText('הקלטה וטקסט אמת מאושר נטענו לניסוי חוזר', { exact: true })).toBeVisible();
    await expect(page.getByText('torah-sample.wav · 0.0 MB', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'הפעל ניסוי מלא' })).toBeEnabled();
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
    await expect(page.getByText('מקור מקושר מהמערכת', { exact: true })).toBeVisible();
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
