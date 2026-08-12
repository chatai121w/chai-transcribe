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
    await page.goto('/text-editor');

    const leftPaneLock = page.getByRole('button', { name: 'פתוח' }).last();
    await leftPaneLock.click();
    await expect(page.getByRole('button', { name: 'נעול' })).toBeVisible();

    const assignButton = page.getByTestId('assign-transcript-folder');
    await expect(assignButton).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('send-transcript-to-compare')).toBeVisible();
    await assignButton.click();

    await expect(page.getByTestId('transcript-folder-dialog')).toBeVisible();
    await expect(page.locator('[data-radix-dialog-overlay]')).toHaveCount(0);

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
    await expect(page.getByText('הגרסה החדשה נבחרה')).toBeVisible();
  });
});
