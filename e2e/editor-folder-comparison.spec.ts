import { test, expect, injectAuthSession, mockLocalServer, mockSupabase, MOCK_TRANSCRIPTS } from './helpers';

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
    ];
    await page.route('**/rest/v1/folders**', (route) => route.fulfill({ status: 200, json: folders }));
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
    expect(Math.abs(viewport!.width - (box!.x + box!.width) - 16)).toBeLessThanOrEqual(2);

    await expect(dialog.getByText('תיקיית משנה', { exact: true })).toBeHidden();
    await dialog.getByRole('button', { name: 'הרחב את תיקיית אב' }).click();
    await expect(dialog.getByText('תיקיית משנה', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'מזער הכול' }).click();
    await expect(dialog.getByText('תיקיית משנה', { exact: true })).toBeHidden();
    await dialog.getByRole('button', { name: 'הרחב הכול' }).click();
    await expect(dialog.getByText('תיקיית משנה', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'סגור', exact: true }).click();

    const followButton = page.getByRole('button', { name: 'עוקב' }).first();
    await followButton.click();
    await expect(page.getByRole('button', { name: 'לא עוקב' }).first()).toBeVisible();
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
    await dialog.getByRole('button', { name: /שיעורים מסווגים/ }).click();
    await dialog.getByRole('button', { name: new RegExp(MOCK_TRANSCRIPTS[0].title) }).click();
    await expect(baseChooser).toContainText(MOCK_TRANSCRIPTS[0].title);

    await newChooser.click();
    await expect(dialog.getByRole('heading', { name: 'בחירת גרסה חדשה' })).toBeVisible();
    await dialog.getByRole('button', { name: new RegExp(comparisonTranscript.title) }).click();

    await expect(baseChooser).toContainText(MOCK_TRANSCRIPTS[0].title);
    await expect(newChooser).toContainText(comparisonTranscript.title);
    await expect(page.getByText('הגרסה החדשה נבחרה', { exact: true })).toBeVisible();
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
    await expect(page.getByRole('menuitem', { name: 'ייצוא ל-DOCX' })).toBeVisible();
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
    await page.getByTestId('confirm-quick-all').click();
    await page.getByRole('button', { name: 'תצוגה רציפה' }).click();
    await expect(page.getByText('הוכרעו 1')).toBeVisible();
    await page.getByRole('tab', { name: 'הכרעה', exact: true }).click();

    await expect(page.getByTestId('verified-text')).toHaveValue('חורבן כאן, ועוד חורבן. אבל מחורבים לא');
    await expect(page.getByTestId('global-replacement-rules')).toContainText('החלף בכל הטקסט: חורבים ב-חורבן');
  });
});
