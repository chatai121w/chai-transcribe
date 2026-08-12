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
    await page.goto('/text-editor');
    await page.getByTestId('send-transcript-to-compare').click();

    const libraryButton = page.getByRole('button', { name: 'בחר מתיקיות ותמלולים' });
    await expect(libraryButton).toBeVisible({ timeout: 15_000 });
    await libraryButton.click();

    const firstRow = page.getByText(MOCK_TRANSCRIPTS[0].title).locator('..').locator('..');
    const secondRow = page.getByText(MOCK_TRANSCRIPTS[1].title).locator('..').locator('..');
    await firstRow.getByRole('button', { name: 'בסיס' }).click();
    await secondRow.getByRole('button', { name: 'חדש' }).click();
    await page.getByRole('button', { name: 'השווה נבחרים' }).click();

    await expect(page.getByText('שני תמלולים נטענו להשוואה')).toBeVisible();
    await expect(page.getByText(/תמלול בדיקה 1/).first()).toBeVisible();
    await expect(page.getByText(/תמלול בדיקה 2/).first()).toBeVisible();
  });
});
