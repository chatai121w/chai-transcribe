import { expect, injectAuthSession, mockLocalServer, mockSupabase, test } from './helpers';

test.describe('Central Torah vocabulary', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await mockLocalServer(page);
    await injectAuthSession(page);
  });

  test('keeps one canonical corpus and rejects duplicate spellings', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto('/personal-learning?tab=vocabulary', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'מילון ולמידה אישית' })).toBeVisible();
    await expect(page.getByText('מילון מונחים מרכזי')).toBeVisible();
    await expect(page.getByText(/מונחים ללא כפילויות/)).toBeVisible();

    const termInput = page.getByPlaceholder('מונח חדש...');
    const addButton = termInput.locator('xpath=..').getByRole('button').last();
    await termInput.fill('רש"י');
    await addButton.click();
    await expect(page.getByText('כבר קיים', { exact: true })).toBeVisible();

    await termInput.fill('מונח אישי לבדיקת מילון');
    await addButton.click();
    await expect(page.getByText('נוסף', { exact: true })).toBeVisible();

    const audit = await page.evaluate(() => {
      const entries = JSON.parse(localStorage.getItem('custom_vocabulary') || '[]') as Array<{ term: string; source: string }>;
      const normalize = (value: string) => value
        .normalize('NFKC')
        .replace(/[\u05F3\u05F4"']/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('he');
      const keys = entries.map(entry => normalize(entry.term));
      return {
        total: entries.length,
        unique: new Set(keys).size,
        personal: entries.filter(entry => entry.source !== 'built-in').length,
      };
    });

    expect(audit.total).toBeGreaterThan(100);
    expect(audit.unique).toBe(audit.total);
    expect(audit.personal).toBe(1);
    expect(pageErrors).toEqual([]);
  });
});
