import { test, expect, injectAuthSession, mockLocalServer, mockSupabase, MOCK_TRANSCRIPTS } from './helpers';

test.describe('ניהול תיקיות - פעולות מהירות לקובץ', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page);
    await page.goto('/folders');
  });

  test('ריחוף מציג שלוש פעולות ופותח את אותו תמלול בכל יעד', async ({ page }) => {
    const transcript = MOCK_TRANSCRIPTS[0];
    const openQuickActions = async () => {
      const cardTitle = page.getByText(transcript.title, { exact: true }).first();
      await expect(cardTitle).toBeVisible({ timeout: 15_000 });
      await cardTitle.hover();
      await expect(page.getByTestId(`file-quick-actions-${transcript.id}`)).toBeVisible();
    };

    await openQuickActions();

    const actions = page.getByTestId(`file-quick-actions-${transcript.id}`);
    await expect(actions.getByRole('button', { name: 'פתח בעורך הטקסט' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'פתח בעריכה עם AI' })).toBeVisible();
    await expect(actions.getByRole('button', { name: 'פתח במערכת ההשוואה' })).toBeVisible();

    await page.getByTestId(`file-open-editor-${transcript.id}`).click();
    await expect(page).toHaveURL(/\/text-editor$/);
    await expect(page.getByRole('tab', { name: 'עורך טקסט' })).toHaveAttribute('data-state', 'active');

    await page.goto('/folders');
    await openQuickActions();
    await page.getByTestId(`file-open-ai-${transcript.id}`).click();
    await expect(page).toHaveURL(/\/text-editor$/);
    await expect(page.getByRole('tab', { name: 'עריכה עם AI' })).toHaveAttribute('data-state', 'active');

    await page.goto('/folders');
    await openQuickActions();
    await page.getByTestId(`file-open-compare-${transcript.id}`).click();
    await expect(page).toHaveURL(/\/text-editor$/);
    await expect(page.getByRole('tab', { name: 'השוואה' })).toHaveAttribute('data-state', 'active');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('current_transcript_id'))).toBe(transcript.id);
  });
});
