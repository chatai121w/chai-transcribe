import { expect, test } from '@playwright/test';
import { mockSupabase } from './helpers';

test.describe('מנועי תרגום מקומיים', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.addInitScript(() => {
      localStorage.setItem('sb-pycryoyipkymaqorgpjy-auth-token', JSON.stringify({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'test-user-00000000-0000-0000-0000-000000000001', email: 'test@example.com' },
      }));
    });
  });

  test('מציג חיבור, הורדות ומודל Ollama מותקן בבורר', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    let ollamaRunning = false;
    await page.route('**/__api/start-ollama', route => {
      ollamaRunning = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, running: true, message: 'started' }) });
    });
    await page.route('http://localhost:11434/api/tags', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: ollamaRunning ? JSON.stringify({
        models: [{ name: 'translategemma:4b', size: 3_300_000_000, modified_at: new Date().toISOString(), digest: 'test', details: { parameter_size: '4B' } }],
      }) : '{',
    }));
    await page.route('http://127.0.0.1:11434/api/tags', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: ollamaRunning ? JSON.stringify({
        models: [{ name: 'translategemma:4b', size: 3_300_000_000, modified_at: new Date().toISOString(), digest: 'test', details: { parameter_size: '4B' } }],
      }) : '{',
    }));

    await page.goto('/translation');
    await expect(page.getByRole('heading', { name: 'מרכז תרגום' })).toBeVisible();
    await expect(page.getByText('Ollama אינו מחובר').first()).toBeVisible();

    await page.getByRole('button', { name: 'הפעל Ollama' }).click();
    await expect(page.getByText(/Ollama מחובר · 1 מודלים מותקנים/)).toBeVisible();

    await page.getByText('מנוע תרגום').locator('..').getByRole('combobox').click();
    await expect(page.getByRole('option', { name: /translategemma:4b/ })).toBeVisible();
    await page.getByRole('option', { name: /translategemma:4b/ }).click();
    await expect(page.getByText('יש לבחור שפת מקור ידנית עבור TranslateGemma.')).toBeVisible();

    await page.getByRole('button', { name: 'מודלים והורדות' }).first().click();
    await expect(page.getByRole('heading', { name: 'מודלים מקומיים והורדות' })).toBeVisible();
    await expect(page.getByText('מודלים מותקנים (1)')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
