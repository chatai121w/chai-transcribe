import { test, expect, createTestAudioBuffer, injectAuthSession, mockLocalServer, mockSupabase, MOCK_TRANSCRIPTS } from './helpers';

test.describe('עורך טקסט - תיקיות והשוואה', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.addInitScript(() => {
      localStorage.setItem('current_transcript_id', 'tr-002');
      localStorage.setItem('current_editing_text', 'תמלול שני לבדיקת המערכת');
    });
  });

  test('שיוך לתיקייה נפתח ללא חסימת העורך', async ({ page }) => {
    const now = new Date().toISOString();
    const folders = [
      {
        id: 'folder-parent', user_id: 'test-user-00000000-0000-0000-0000-000000000001', parent_id: null,
        name: 'תיקיית אב', color: null, emoji: null, pinned: false, position: 0,
        drive_folder_id: null, drive_folder_name: null, drive_synced_at: null, created_at: now, updated_at: now,
      },
      {
        id: 'folder-child', user_id: 'test-user-00000000-0000-0000-0000-000000000001', parent_id: 'folder-parent',
        name: 'תיקיית משנה', color: null, emoji: null, pinned: false, position: 0,
        drive_folder_id: null, drive_folder_name: null, drive_synced_at: null, created_at: now, updated_at: now,
      },
      {
        id: 'folder-source', user_id: 'test-user-00000000-0000-0000-0000-000000000001', parent_id: null,
        name: 'תיקיית מקור', color: null, emoji: null, pinned: false, position: 1,
        drive_folder_id: null, drive_folder_name: null, drive_synced_at: null, created_at: now, updated_at: now,
      },
    ];
    const writes: Array<{ method: string; body: string | null }> = [];
    await page.route('**/rest/v1/folders**', (route) => {
      const method = route.request().method();
      if (method !== 'GET') {
        writes.push({ method, body: route.request().postData() });
        const body = JSON.parse(route.request().postData() || '{}');
        return route.fulfill({
          status: 200,
          json: method === 'POST' ? { ...folders[0], ...body, id: `created-${writes.length}` } : {},
        });
      }
      return route.fulfill({ status: 200, json: folders });
    });
    await page.goto('/text-editor');

    const leftPaneLock = page.getByRole('button', { name: 'פתוח' }).last();
    await leftPaneLock.click();
    await expect(page.getByRole('button', { name: 'נעול' })).toBeVisible();

    const assignButton = page.getByTestId('assign-transcript-folder');
    await expect(assignButton).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('send-transcript-to-compare')).toBeVisible();
    await assignButton.click();

    const dialog = page.getByTestId('transcript-folder-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-radix-dialog-overlay]')).toHaveCount(0);
    await expect(dialog).toHaveCSS('direction', 'rtl');
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(8);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height - 8);
    await expect(dialog.getByRole('tree', { name: 'עץ תיקיות סיווג' })).toHaveCount(1);

    await expect(dialog.getByText('תיקיית משנה', { exact: true })).toBeHidden();
    await dialog.getByRole('button', { name: 'הרחב את תיקיית אב' }).click();
    await expect(dialog.getByText('תיקיית משנה', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'מזער את תיקיית אב' }).click();
    await expect(dialog.getByText('תיקיית משנה', { exact: true })).toBeHidden();

    await dialog.getByRole('button', { name: 'צור תיקייה ראשית' }).click();
    await dialog.getByRole('textbox', { name: 'שם תיקייה ראשית חדשה' }).fill('תיקייה ראשית חדשה');
    await dialog.getByRole('button', { name: 'שמור תיקייה חדשה' }).click();

    const targetRow = dialog.getByTestId('cut-folder-folder-parent');
    await targetRow.hover();
    await dialog.getByRole('button', { name: 'צור תת-תיקייה בתוך תיקיית אב' }).click();
    await dialog.getByRole('textbox', { name: 'שם תת-תיקייה חדשה' }).fill('תת תיקייה חדשה');
    await dialog.getByRole('textbox', { name: 'שם תת-תיקייה חדשה' }).press('Enter');

    await expect.poll(() => writes.some(({ body }) => body?.includes('תיקייה ראשית חדשה') && body.includes('"parent_id":null'))).toBe(true);
    await expect.poll(() => writes.some(({ body }) => body?.includes('תת תיקייה חדשה') && body.includes('folder-parent'))).toBe(true);

    const search = dialog.getByRole('textbox', { name: 'חיפוש תיקייה' });
    await search.fill('מקור');
    await expect(dialog.getByText('תיקיית מקור', { exact: true })).toBeVisible();
    await expect(dialog.getByText('תיקיית אב', { exact: true })).toBeHidden();
    await search.clear();

    const dragHandle = dialog.getByRole('button', { name: 'גרור את תיקיית מקור' });
    const dragBox = await dragHandle.boundingBox();
    const dropBox = await targetRow.boundingBox();
    expect(dragBox).not.toBeNull();
    expect(dropBox).not.toBeNull();
    await page.mouse.move(dragBox!.x + dragBox!.width / 2, dragBox!.y + dragBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(dragBox!.x + dragBox!.width / 2 + 12, dragBox!.y + dragBox!.height / 2, { steps: 3 });
    await page.mouse.move(dropBox!.x + dropBox!.width / 2, dropBox!.y + dropBox!.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => writes.some(({ method, body }) => method === 'PATCH' && body?.includes('folder-parent'))).toBe(true);

    await dialog.getByRole('button', { name: 'סגור', exact: true }).click();

    const followButton = page.getByRole('button', { name: 'עוקב' }).first();
    await followButton.click();
    await expect(page.getByRole('button', { name: 'לא עוקב' }).first()).toBeVisible();
  });

  test('שם ההקלטה ושם התיקייה מיושרים לימין וניתנים לעריכה', async ({ page }) => {
    const folder = {
      id: 'folder-edit', user_id: 'test-user-00000000-0000-0000-0000-000000000001', parent_id: null,
      name: 'שם תיקייה קודם', color: null, emoji: null, pinned: false, position: 0,
      drive_folder_id: null, drive_folder_name: null, drive_synced_at: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const transcripts = MOCK_TRANSCRIPTS.map((item) => item.id === 'tr-002'
      ? { ...item, title: 'שם הקלטה קודם', folder_id: folder.id, folder: folder.name }
      : item);
    const writes: Array<{ url: string; body: string | null }> = [];

    await page.route('**/rest/v1/folders**', async route => {
      if (route.request().method() !== 'GET') {
        writes.push({ url: route.request().url(), body: route.request().postData() });
        return route.fulfill({ status: 200, json: {} });
      }
      return route.fulfill({ status: 200, json: [folder] });
    });
    await page.route('**/rest/v1/transcripts**', async route => {
      if (route.request().method() !== 'GET') {
        writes.push({ url: route.request().url(), body: route.request().postData() });
        return route.fulfill({ status: 200, json: {} });
      }
      return route.fulfill({ status: 200, json: transcripts });
    });
    await page.goto('/text-editor');

    const titleLabel = page.getByText('שם התמלול:', { exact: true });
    const folderLabel = page.getByText('שם התיקייה:', { exact: true });
    await expect(titleLabel).toBeVisible({ timeout: 15_000 });
    await expect(folderLabel).toBeVisible();
    await expect(titleLabel.locator('..')).toHaveCSS('direction', 'rtl');
    await expect(folderLabel.locator('..')).toHaveCSS('direction', 'rtl');

    await titleLabel.locator('..').getByRole('button', { name: 'ערוך' }).click();
    const titleInput = titleLabel.locator('..').getByRole('textbox');
    await titleInput.fill('שם הקלטה חדש');
    await titleLabel.locator('..').getByRole('button', { name: 'שמור' }).click();

    await folderLabel.locator('..').getByRole('button', { name: 'ערוך' }).click();
    const folderInput = page.getByRole('textbox', { name: 'עריכת שם התיקייה' });
    await folderInput.fill('שם תיקייה חדש');
    await folderLabel.locator('..').getByRole('button', { name: 'שמור' }).click();

    await expect.poll(() => writes.some((write) => write.body?.includes('שם הקלטה חדש'))).toBe(true);
    await expect.poll(() => writes.some((write) => write.body?.includes('שם תיקייה חדש'))).toBe(true);

    await page.getByTestId('send-transcript-to-compare').click();
    await page.getByTestId('choose-comparison-base').click();
    const comparisonDialog = page.getByTestId('comparison-source-dialog');
    await expect(comparisonDialog).toHaveCSS('direction', 'rtl');
    await comparisonDialog.getByRole('button', { name: 'פתח את תיקיית שם תיקייה קודם' }).click();

    await comparisonDialog.getByRole('button', { name: 'ערוך שם תיקייה' }).click();
    const dialogFolderInput = comparisonDialog.getByRole('textbox', { name: 'שם התיקייה' });
    await expect(dialogFolderInput).toHaveCSS('text-align', 'right');
    await dialogFolderInput.fill('תיקייה מהחלון');
    await comparisonDialog.getByRole('button', { name: 'שמור שם' }).click();

    await comparisonDialog.getByRole('button', { name: 'ערוך שם הקלטה' }).first().click();
    const dialogTranscriptInput = comparisonDialog.getByRole('textbox', { name: 'שם ההקלטה' });
    await expect(dialogTranscriptInput).toHaveCSS('text-align', 'right');
    await dialogTranscriptInput.fill('הקלטה מהחלון');
    await dialogTranscriptInput.press('Enter');

    await expect.poll(() => writes.some((write) => write.body?.includes('תיקייה מהחלון'))).toBe(true);
    await expect.poll(() => writes.some((write) => write.body?.includes('הקלטה מהחלון'))).toBe(true);
  });

  test('גרסאות להשוואה מציגות מנוע, סוג גרסה ומידע מובנה במקום הכיתוב מקורי', async ({ page }) => {
    await page.goto('/text-editor');
    await page.getByTestId('send-transcript-to-compare').click();
    await page.getByTestId('choose-comparison-base').click();

    const dialog = page.getByTestId('comparison-source-dialog');
    await dialog.getByRole('tab', { name: 'גרסאות קיימות' }).click();
    const original = dialog.getByTestId('comparison-version-current-original');

    await expect(original).toBeVisible();
    await expect(original.getByText('OpenAI Whisper', { exact: true })).toBeVisible();
    await expect(original.getByText('תמלול ראשון', { exact: true })).toBeVisible();
    await expect(original).toContainText('מילים');
    await expect(original).not.toContainText('המנוע לא נשמר');
    await expect(original).not.toContainText('מקורי');
    await expect(original).toHaveCSS('direction', 'rtl');
  });

  test('תמלול נוסף מאותה הקלטה נשמר כגרסה ונפתח להשוואה בלי לדרוס את המקור', async ({ page }) => {
    const versionWrites: Array<Record<string, unknown>> = [];
    const jobWrites: Array<{ method: string; body: Record<string, unknown> }> = [];
    let audioSessionUploads = 0;
    const transcriptionBodies: Array<string> = [];
    await mockLocalServer(page, { connected: true, model: 'ivrit-ai/whisper-large-v3-turbo-ct2' });
    for (const pattern of ['**/localhost:3000/audio-sessions**', '**/whisper/audio-sessions**']) {
      await page.route(pattern, async (route) => {
        if (route.request().method() === 'POST') audioSessionUploads += 1;
        await route.fallback();
      });
    }
    await page.route('**/rest/v1/transcript_versions**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') return route.fulfill({ status: 200, json: [] });
      const body = route.request().postDataJSON() as Record<string, unknown>;
      versionWrites.push(body);
      return route.fulfill({
        status: 201,
        json: {
          ...body,
          id: 'version-retranscribed',
          version_number: 1,
          word_count: 4,
          created_at: new Date().toISOString(),
        },
      });
    });
    await page.route('**/rest/v1/transcription_jobs**', async (route) => {
      const method = route.request().method();
      if (method === 'GET') return route.fulfill({ status: 200, json: [] });
      const body = (route.request().postDataJSON() || {}) as Record<string, unknown>;
      jobWrites.push({ method, body });
      if (method === 'POST') return route.fulfill({ status: 201, json: { ...body, id: 'job-retranscribed' } });
      return route.fulfill({ status: 200, json: {} });
    });
    for (const pattern of ['**/localhost:3000/transcribe-stream', '**/whisper/transcribe-stream']) {
      await page.route(pattern, async (route) => {
        transcriptionBodies.push(route.request().postData() || '');
        await new Promise((resolve) => setTimeout(resolve, 750));
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
          body: [
            'data: {"type":"source","duration":2.0,"audio_session_id":"audio-session-e2e","session_reused":true}\n\n',
            'data: {"type":"preprocessing","duration":2.0,"message":"Preparing audio and VAD"}\n\n',
            'data: {"type":"info","duration":2.0,"model":"ivrit-ai/whisper-large-v3-turbo-ct2"}\n\n',
            'data: {"type":"segment","text":"תמלול חדש ממנוע אחר","progress":100,"segEnd":2,"words":[{"word":"תמלול","start":0,"end":0.5}]}\n\n',
            'data: {"type":"done","text":"תמלול חדש ממנוע אחר","duration":2,"language":"he","model":"ivrit-ai/whisper-large-v3-turbo-ct2","wordTimings":[{"word":"תמלול","start":0,"end":0.5}]}\n\n',
          ].join(''),
        });
      });
    }

    await page.goto('/text-editor');
    const button = page.getByTestId('retranscribe-audio');
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();

    const dialog = page.getByTestId('retranscribe-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-radix-dialog-overlay]')).toHaveCount(0);
    await expect(dialog).toHaveCSS('direction', 'rtl');
    await dialog.getByLabel('מנוע לתמלול נוסף').click();
    await page.getByRole('option', { name: /CUDA מקומי/ }).click();
    await dialog.getByTestId('retranscription-source-file').setInputFiles({
      name: 'same-recording.wav',
      mimeType: 'audio/wav',
      buffer: createTestAudioBuffer(),
    });
    await dialog.getByTestId('start-retranscription').click();
    const progressPanel = dialog.getByTestId('retranscription-progress');
    await expect(progressPanel).toBeVisible();
    await expect(progressPanel).toContainText('זמן שחלף');
    await expect(progressPanel).not.toContainText('%');
    await dialog.getByTestId('minimize-retranscription').click();
    const minimized = page.getByTestId('retranscribe-minimized');
    await expect(minimized).toBeVisible();
    await expect(minimized).toContainText('תמלול נוסף מאותה הקלטה');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(minimized).toBeHidden();
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText('נשמרה גרסה חדשה וההשוואה מוכנה')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => versionWrites.length).toBe(1);
    expect(versionWrites[0].source).toBe('transcription');
    expect(versionWrites[0].text).toBe('תמלול חדש ממנוע אחר');
    expect(versionWrites[0].word_timings).toEqual([{ word: 'תמלול', start: 0, end: 0.5 }]);
    expect(versionWrites[0].transcription_job_id).toBe('job-retranscribed');
    await expect.poll(() => jobWrites.some((write) => write.method === 'PATCH' && write.body.status === 'completed')).toBe(true);
    expect(audioSessionUploads).toBe(1);
    expect(transcriptionBodies[0]).toContain('audio_session_id');

    await dialog.getByRole('button', { name: 'סגור' }).click();
    await expect(page.getByRole('tab', { name: 'השוואה', exact: true })).toHaveAttribute('data-state', 'active');
    await expect(page.getByText('תמלול שני לבדיקת המערכת', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('תמלול חדש ממנוע אחר', { exact: true }).first()).toBeVisible();

    await button.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('cuda-audio-session-ready')).toBeVisible();
    await dialog.getByLabel('מודל CUDA לתמלול נוסף').click();
    await page.getByRole('option', { name: /Ivrit.ai Large V3 - דיוק מרבי/ }).click();
    await dialog.getByTestId('start-retranscription').click();
    await expect(dialog.getByText('נשמרה גרסה חדשה וההשוואה מוכנה')).toBeVisible({ timeout: 30_000 });
    expect(audioSessionUploads).toBe(1);
    expect(transcriptionBodies[1]).toContain('audio_session_id');
  });

  test('בחירת תמלולים מתוך העץ טוענת זוג אמיתי להשוואה', async ({ page }) => {
    const folder = {
      id: 'folder-lessons',
      user_id: 'test-user-00000000-0000-0000-0000-000000000001',
      parent_id: null,
      name: 'שיעורים מסווגים',
      color: null,
      emoji: '🎙️',
      pinned: false,
      position: 0,
      drive_folder_id: null,
      drive_folder_name: null,
      drive_synced_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const comparisonTranscript = {
      ...MOCK_TRANSCRIPTS[1],
      id: 'tr-003',
      title: 'תמלול בדיקה 3',
      text: 'נוסח שלישי ושונה שנבחר מתוך התיקייה להשוואה',
      created_at: new Date(Date.now() + 1_000).toISOString(),
    };
    const categorizedTranscripts = [...MOCK_TRANSCRIPTS, comparisonTranscript].map((transcript) => ({
      ...transcript,
      folder_id: folder.id,
      folder: folder.name,
    }));
    await page.route('**/rest/v1/folders**', (route) => route.fulfill({ status: 200, json: [folder] }));
    await page.route('**/rest/v1/transcripts**', (route) => route.fulfill({ status: 200, json: categorizedTranscripts }));

    await page.goto('/text-editor');
    await page.getByTestId('send-transcript-to-compare').click();

    const baseChooser = page.getByTestId('choose-comparison-base');
    const newChooser = page.getByTestId('choose-comparison-new');
    await expect(baseChooser).toBeVisible({ timeout: 15_000 });
    await expect(newChooser).toBeVisible();
    await expect(page.getByRole('button', { name: 'בחר מתיקיות ותמלולים' })).toHaveCount(0);

    await baseChooser.click();
    const dialog = page.getByTestId('comparison-source-dialog');
    await expect(dialog.getByRole('heading', { name: 'בחירת גרסת בסיס' })).toBeVisible();
    await dialog.getByRole('button', { name: 'פתח את תיקיית שיעורים מסווגים' }).click();
    await dialog.getByRole('button', { name: new RegExp(MOCK_TRANSCRIPTS[0].title) }).click();
    await expect(baseChooser).toContainText(MOCK_TRANSCRIPTS[0].title);

    await newChooser.click();
    await expect(dialog.getByRole('heading', { name: 'בחירת גרסה חדשה' })).toBeVisible();
    await dialog.getByRole('button', { name: new RegExp(comparisonTranscript.title) }).click();

    await expect(baseChooser).toContainText(MOCK_TRANSCRIPTS[0].title);
    await expect(newChooser).toContainText(comparisonTranscript.title);
    await expect(page.getByText('הגרסה החדשה נבחרה', { exact: true })).toBeVisible();
  });

  test('ניהול תיקיות בחלון ההשוואה תומך ביצירה, קינון וגרירה ללא חסימת העורך', async ({ page }) => {
    const now = new Date().toISOString();
    const folders = [
      {
        id: 'folder-drag-source', user_id: 'test-user-00000000-0000-0000-0000-000000000001', parent_id: null,
        name: 'תיקיית מקור', color: null, emoji: null, pinned: false, position: 0,
        drive_folder_id: null, drive_folder_name: null, drive_synced_at: null, created_at: now, updated_at: now,
      },
      {
        id: 'folder-drag-target', user_id: 'test-user-00000000-0000-0000-0000-000000000001', parent_id: null,
        name: 'תיקיית יעד', color: null, emoji: null, pinned: false, position: 1,
        drive_folder_id: null, drive_folder_name: null, drive_synced_at: null, created_at: now, updated_at: now,
      },
    ];
    const writes: Array<{ method: string; body: string | null }> = [];
    await page.route('**/rest/v1/folders**', async route => {
      const method = route.request().method();
      if (method !== 'GET') {
        writes.push({ method, body: route.request().postData() });
        return route.fulfill({ status: 200, json: method === 'POST' ? { ...folders[0], id: `created-${writes.length}` } : {} });
      }
      return route.fulfill({ status: 200, json: folders });
    });

    await page.goto('/text-editor');
    await page.getByTestId('send-transcript-to-compare').click();
    await page.getByTestId('choose-comparison-base').click();
    const dialog = page.getByTestId('comparison-source-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('[data-radix-dialog-overlay]')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'תיקייה חדשה' }).click();
    await dialog.getByRole('textbox', { name: 'שם תיקייה ראשית חדשה' }).fill('תיקייה ראשית חדשה');
    await dialog.getByRole('button', { name: 'שמור תיקייה חדשה' }).click();

    await dialog.getByRole('button', { name: 'צור תת-תיקייה בתוך תיקיית יעד' }).click();
    await dialog.getByRole('textbox', { name: 'שם תת-תיקייה חדשה' }).fill('תת תיקייה חדשה');
    await dialog.getByRole('textbox', { name: 'שם תת-תיקייה חדשה' }).press('Enter');

    await expect.poll(() => writes.some(({ body }) => body?.includes('תיקייה ראשית חדשה') && body.includes('"parent_id":null'))).toBe(true);
    await expect.poll(() => writes.some(({ body }) => body?.includes('תת תיקייה חדשה') && body.includes('folder-drag-target'))).toBe(true);

    const dragHandle = dialog.getByRole('button', { name: 'גרור את תיקיית מקור' });
    const dropTarget = dialog.getByTestId('comparison-folder-folder-drag-target');
    const dragBox = await dragHandle.boundingBox();
    const dropBox = await dropTarget.boundingBox();
    expect(dragBox).not.toBeNull();
    expect(dropBox).not.toBeNull();
    await page.mouse.move(dragBox!.x + dragBox!.width / 2, dragBox!.y + dragBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(dragBox!.x + dragBox!.width / 2 + 12, dragBox!.y + dragBox!.height / 2, { steps: 3 });
    await page.mouse.move(dropBox!.x + dropBox!.width / 2, dropBox!.y + dropBox!.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(() => writes.some(({ method, body }) => method === 'PATCH' && body?.includes('folder-drag-target'))).toBe(true);
  });

  test('חיבור התמלול לווידאו משתמש בתזמונים ומוריד קובץ', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('last_word_timings_transcript_id', 'tr-002');
      localStorage.setItem('last_word_timings', JSON.stringify([
        { word: 'תמלול', start: 0, end: 0.55 },
        { word: 'שני', start: 0.6, end: 1.0 },
        { word: 'לבדיקת', start: 1.05, end: 1.55 },
        { word: 'המערכת.', start: 1.6, end: 2.1 },
      ]));
    });
    let muxCalled = false;
    await page.route('**/media/subtitles', async (route) => {
      muxCalled = true;
      expect(route.request().postData() || '').toContain('"language":"he"');
      await route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from('mock-mp4') });
    });
    await page.goto('/text-editor');
    const primaryTabs = page.getByRole('tablist').first();
    await expect(primaryTabs).toHaveCSS('direction', 'rtl');
    const visiblePrimaryTabs = primaryTabs.getByRole('tab');
    await expect(visiblePrimaryTabs).toHaveCount(6);
    const firstTabBox = await visiblePrimaryTabs.nth(0).boundingBox();
    const secondTabBox = await visiblePrimaryTabs.nth(1).boundingBox();
    expect(firstTabBox).not.toBeNull();
    expect(secondTabBox).not.toBeNull();
    expect(firstTabBox!.x).toBeGreaterThan(secondTabBox!.x);

    await page.getByTestId('export-transcript').click();
    await expect(page.getByRole('menuitem', { name: 'ייצוא ל-PDF' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Word עם פיסוק ופסקאות' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'ייצוא ל-SRT (כתוביות)' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'ייצוא ל-VTT (כתוביות)' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'ייצוא הכול (ZIP)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('attach-transcript-to-video').click();
    const dialog = page.getByTestId('attach-transcript-video-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('אנגלית').uncheck();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'lesson.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('mock-video'),
    });
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'צור והורד וידאו' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('with-subtitles.mp4');
    expect(muxCalled).toBe(true);
  });

  test('הכרעה מתקנת את כל המופעים הזהים ושומרת מילים ארוכות', async ({ page }) => {
    await page.addInitScript(() => {
      const timestamp = new Date('2026-08-13T09:00:00Z').toISOString();
      localStorage.setItem('current_editing_text', 'חורבן כאן, ועוד חורבים. אבל מחורבים לא');
      localStorage.setItem('text_versions', JSON.stringify([
        {
          id: 'repeat-base',
          text: 'חורבים כאן, ועוד חורבים. אבל מחורבים לא',
          timestamp,
          source: 'original',
        },
        {
          id: 'repeat-new',
          text: 'חורבן כאן, ועוד חורבים. אבל מחורבים לא',
          timestamp: new Date('2026-08-13T09:01:00Z').toISOString(),
          source: 'manual',
        },
      ]));
    });

    await page.goto('/text-editor');
    await page.getByRole('tab', { name: 'השוואה' }).click();
    await expect(page.getByRole('tab', { name: 'הכרעה צד-בצד' })).toHaveCount(0);
    await page.getByRole('button', { name: 'תצוגה לפי הבדלים' }).click();
    await page.getByTitle('לחץ פעמיים לאפשרויות אישור מהגרסה החדשה').dblclick();
    await expect(page.getByTestId('quick-adjudication-dialog')).toBeVisible();
    await expect(page.locator('[data-radix-dialog-overlay]')).toHaveCount(0);
    await page.getByTestId('minimize-quick-adjudication').click();
    await expect(page.getByTestId('quick-adjudication-minimized')).toBeVisible();
    await page.getByRole('button', { name: 'הרחב חלון הכרעה' }).click();
    await expect(page.getByTestId('quick-adjudication-dialog')).toBeVisible();
    await page.getByTestId('confirm-quick-all').click();
    await page.getByRole('button', { name: 'תצוגה רציפה' }).click();
    await expect(page.getByText('הוכרעו 1')).toBeVisible();
    await page.getByRole('tab', { name: 'הכרעה', exact: true }).click();

    await expect(page.getByTestId('verified-text')).toHaveValue('חורבן כאן, ועוד חורבן. אבל מחורבים לא');
    await expect(page.getByTestId('global-replacement-rules')).toContainText('החלף בכל הטקסט: חורבים ב-חורבן');
  });
});
