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

  test('עומס 503 ב-Gemini מפעיל ניסיונות חוזרים ומעבר אוטומטי לענן החלופי', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('gemini_api_key', 'AIza-test-key');
      localStorage.setItem('use_personal_gemini', '1');
      localStorage.setItem('personal_gemini_fallback', '0');
    });

    let personalGeminiRequests = 0;
    let fallbackRequests = 0;
    let dbProxyRequests = 0;
    let fallbackBody: Record<string, unknown> | null = null;
    await page.route('https://generativelanguage.googleapis.com/**', async route => {
      personalGeminiRequests += 1;
      await route.fulfill({
        status: 503,
        headers: { 'retry-after': '0' },
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 503,
            message: 'This model is currently experiencing high demand.',
            status: 'UNAVAILABLE',
          },
        }),
      });
    });
    await page.route('**/rest/v1/rpc/edit_transcript_proxy**', async route => {
      dbProxyRequests += 1;
      await route.fulfill({ status: 500, json: { error: 'DB proxy must be skipped' } });
    });
    await page.route('**/functions/v1/edit-transcript', async route => {
      fallbackRequests += 1;
      fallbackBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: 'Translation completed by the automatic fallback.' }),
      });
    });

    await page.goto('/translation');
    await page.locator('textarea').first().fill('טקסט עברי שנועד לבדוק התאוששות אוטומטית מעומס זמני בשירות התרגום.');
    await page.getByRole('button', { name: 'תרגם', exact: true }).click();

    await expect(page.getByText('Gemini עמוס זמנית — עוברים אוטומטית לקרדיטים של Lovable')).toBeVisible();
    await expect(page.locator('textarea').nth(2)).toHaveValue('Translation completed by the automatic fallback.');
    expect(personalGeminiRequests).toBe(3);
    expect(fallbackRequests).toBe(1);
    expect(dbProxyRequests).toBe(0);
    expect(fallbackBody).toMatchObject({ model: 'google/gemini-2.5-flash' });
  });

  test('בקשת ענן תקועה ניתנת לביטול ומשחררת את ממשק התרגום', async ({ page }) => {
    let requestStarted = false;
    await page.route('**/rest/v1/rpc/edit_transcript_proxy**', async route => {
      requestStarted = true;
      await new Promise(resolve => setTimeout(resolve, 2_000));
      if (!route.request().isNavigationRequest()) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ text: 'A response that arrived too late.' }),
        }).catch(() => undefined);
      }
    });

    await page.goto('/translation');
    await page.locator('textarea').first().fill('טקסט עברי ארוך מספיק לבדיקת ביטול של בקשת תרגום שנתקעה ברשת.');
    await page.getByRole('button', { name: 'תרגם', exact: true }).click();
    await expect.poll(() => requestStarted).toBe(true);
    await expect(page.getByText(/מתרגם מקטע 1 מתוך 1 באמצעות Gemini 2.5 Flash/)).toBeVisible();

    await page.getByRole('button', { name: 'בטל תרגום' }).click();
    await expect(page.getByRole('button', { name: 'בטל תרגום' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'תרגם', exact: true })).toBeEnabled();
    await expect(page.getByText('התרגום בוטל', { exact: true })).toBeVisible();
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
