import { expect, test } from '@playwright/test';
import { injectAuthSession, mockSupabase, MOCK_TRANSCRIPTS } from './helpers';

test('dashboard tolerates incomplete legacy transcript records', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const incompleteTranscript = {
    ...MOCK_TRANSCRIPTS[0],
    id: 'legacy-incomplete-transcript',
    title: undefined,
    text: undefined,
    edited_text: undefined,
    engine: undefined,
  };

  await injectAuthSession(page);
  await mockSupabase(page, {
    transcripts: [incompleteTranscript] as unknown as typeof MOCK_TRANSCRIPTS,
  });

  await page.goto('/');

  await expect(page.getByText('מערכת תמלול מתקדמת')).toBeVisible();
  await expect(page.getByText('ללא טקסט').first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
