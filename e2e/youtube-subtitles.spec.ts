import { expect, test, injectAuthSession, mockLocalServer, mockSupabase } from './helpers';

test.describe('YouTube multilingual subtitle tracks', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    const probeResponse = {
      id: 'video-test',
      title: 'סרטון בדיקה',
      uploader: 'בדיקות',
      duration: 90,
      subtitles: ['he'],
      formats: [],
    };
    for (const pattern of ['**/localhost:3000/yt/info', '**/whisper/yt/info']) {
      await page.route(pattern, (route) => route.fulfill({ status: 200, json: probeResponse }));
    }
  });

  test('offers Hebrew and English tracks and a shared translation engine', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto('/youtube');
    await page.getByPlaceholder('https://www.youtube.com/watch?v=...').fill('https://www.youtube.com/watch?v=video-test');
    await page.getByRole('button', { name: 'בדוק קישור' }).click();
    await expect(page.getByText('סרטון בדיקה')).toBeVisible();
    await page.getByRole('radio', { name: /הכל ביחד/ }).check();

    await expect(page.getByText('כתוביות בתוך קובץ הווידאו')).toBeVisible();
    await expect(page.getByLabel('עברית')).toBeChecked();
    await expect(page.getByLabel('אנגלית')).toBeChecked();
    await page.getByLabel('צרפתית').check();
    await expect(page.getByLabel('צרפתית')).toBeChecked();

    await page.getByRole('combobox').filter({ hasText: /Gemini 2.5 Flash/ }).click();
    await page.getByRole('option', { name: /GPT-5 Mini/ }).click();
    await expect(page.getByRole('combobox').filter({ hasText: /GPT-5 Mini/ })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
