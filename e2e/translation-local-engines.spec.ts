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

  test('מתרגם לאנגלית ב-Ollama ומתקן אוטומטית תשובה שנשארה בעברית', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('hebrew_only_output_enabled', 'true'));
    const models = JSON.stringify({
      models: [{ name: 'translategemma:4b', size: 3_300_000_000, modified_at: new Date().toISOString(), digest: 'test', details: { parameter_size: '4B' } }],
    });
    await page.route('http://localhost:11434/api/tags', route => route.fulfill({ status: 200, contentType: 'application/json', body: models }));
    await page.route('http://127.0.0.1:11434/api/tags', route => route.fulfill({ status: 200, contentType: 'application/json', body: models }));

    const requests: Array<Record<string, unknown>> = [];
    await page.route('http://localhost:11434/v1/chat/completions', async route => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.push(body);
      const content = requests.length === 1
        ? 'זהו הסבר בעברית על הטקסט, במקום התרגום המבוקש לאנגלית, ולכן התוצאה הזאת צריכה להידחות.'
        : 'This is the requested English translation, with no added explanation.';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content } }] }),
      });
    });

    await page.goto('/translation');
    await page.locator('textarea').first().fill('זהו טקסט עברי ארוך מספיק שנועד לבדוק תרגום מלא ומדויק לשפה האנגלית ללא הסברים נוספים.');
    await page.getByText('שפת מקור').locator('..').getByRole('combobox').click();
    await page.getByRole('option', { name: 'עברית' }).click();
    await page.getByText('מנוע תרגום').locator('..').getByRole('combobox').click();
    await page.getByRole('option', { name: /translategemma:4b/ }).click();
    await page.getByRole('button', { name: 'תרגם' }).click();

    await expect(page.locator('textarea').nth(2)).toHaveValue(/requested English translation/);
    expect(requests).toHaveLength(2);
    const firstMessage = ((requests[0].messages as Array<{ content: string }>)[0]).content;
    const retryMessage = ((requests[1].messages as Array<{ content: string }>)[0]).content;
    expect(firstMessage).toContain('Hebrew (he) to English (en) translator');
    expect(firstMessage).toContain('Produce only the English translation');
    expect(firstMessage).not.toContain('OUTPUT LANGUAGE: HEBREW ONLY');
    expect(retryMessage).toContain('wrong language');
  });
});

test.describe('תרגום בענן', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await page.addInitScript(() => {
      localStorage.setItem('hebrew_only_output_enabled', 'true');
      localStorage.setItem('sb-pycryoyipkymaqorgpjy-auth-token', JSON.stringify({
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: 'test-user-00000000-0000-0000-0000-000000000001', email: 'test@example.com' },
      }));
    });
  });

  test('בחירת אנגלית גוברת על מצב עברית בלבד ומציגה התקדמות לפי מקטעים', async ({ page }) => {
    const proxyRequests: Array<Record<string, unknown>> = [];
    await page.route('**/rest/v1/rpc/edit_transcript_proxy**', async route => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      proxyRequests.push(body);
      const callNumber = proxyRequests.length;
      await new Promise(resolve => setTimeout(resolve, callNumber === 1 ? 120 : 700));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: `English translation for chunk ${callNumber}.` }),
      });
    });

    await page.goto('/translation');
    const source = `${'זהו משפט עברי לתרגום מדויק. '.repeat(140)}\n\n${'פסקה עברית נוספת לתרגום. '.repeat(140)}`;
    await page.locator('textarea').first().fill(source);
    await page.getByRole('button', { name: 'תרגם' }).click();

    await expect(page.getByText(/הושלמו 1 מתוך 2 מקטעים/)).toBeVisible();
    await expect(page.locator('textarea').nth(2)).toHaveValue(/English translation for chunk 1[\s\S]*English translation for chunk 2/);
    expect(proxyRequests).toHaveLength(2);
    for (const request of proxyRequests) {
      expect(request.p_action).toBe('custom');
      expect(request.p_custom_prompt).toContain('TARGET LANGUAGE: English (en)');
      expect(request.p_custom_prompt).not.toContain('OUTPUT LANGUAGE: HEBREW ONLY');
    }
  });

  test('מסווג את המקור ואת התרגום בנפרד דרך דיאלוג התיקיות המשותף', async ({ page }) => {
    await page.goto('/translation');

    await page.locator('textarea').first().fill('טקסט מקור שנועד לסיווג עצמאי בתיקייה.');
    await page.getByTestId('classify-translation-source').click();
    await expect(page.getByRole('heading', { name: 'סיווג המקור לתיקייה' })).toBeVisible();
    await expect(page.getByText('המקור והתרגום נשמרים בנפרד.')).toBeVisible();
    await page.getByTestId('transcript-folder-dialog').getByRole('button', { name: 'סגור', exact: true }).click();

    await page.locator('textarea').nth(2).fill('Translated text stored independently.');
    await page.getByTestId('classify-translation-result').click();
    await expect(page.getByRole('heading', { name: 'סיווג התרגום לתיקייה' })).toBeVisible();
    await expect(page.getByTestId('transcript-folder-dialog')).toBeVisible();
  });
});
