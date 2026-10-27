import { test, expect, mockSupabase, injectAuthSession, mockLocalServer } from './helpers';

// שרת הסטודיו (127.0.0.1:8190) מוחלף בדמה: הבדיקה לא מפעילה יצירה אמיתית ולא עוצרת את שרתי התמלול
const STATUS = { 'חי-תמלול': 'פועל', 'תוכנת היצירה': 'כבויה', 'שלב': 'מוכן', 'בתור': 0 };
const JOBS = [
  { id: 'a1', kind: 'image', prompt: 'סלון חרדי', state: 'מוכן', created: 2, file: 'a1.png', seconds_taken: 41,
    engine_prompt: 'Photorealistic Haredi living room', assist_by: 'קלוד', check: { ok: false, problems: ['כיסוי ראש מוסלמי'] }, retries: 1 },
  { id: 'b2', kind: 'video', prompt: 'father turns his head', state: 'בעבודה', created: 3, from_job: 'a1' },
];

test.describe('סטודיו יצירה', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await mockLocalServer(page);
    await injectAuthSession(page);
    await page.route('http://127.0.0.1:8190/status', (r) => r.fulfill({ json: STATUS }));
    await page.route('http://127.0.0.1:8190/jobs', (r) =>
      r.request().method() === 'POST'
        ? r.fulfill({ json: { id: 'c3', kind: 'image', prompt: 'x', state: 'ממתין', created: 4 } })
        : r.fulfill({ json: JOBS }),
    );
    await page.route('http://127.0.0.1:8190/out/**', (r) => r.fulfill({ status: 404, body: '' }));
    await page.route('http://127.0.0.1:8190/cast', (r) => r.fulfill({ json: ['אבא', 'בחור'] }));
    await page.route('http://127.0.0.1:8190/cast/**', (r) => r.fulfill({ status: 404, body: '' }));
  });

  test('תמונה עם דמויות קבועות שולחת את הדיוקנאות לפי הסדר', async ({ page }) => {
    await page.goto('/creation-studio');
    let sent: Record<string, unknown> | null = null;
    page.on('request', (req) => {
      if (req.url().endsWith('/jobs') && req.method() === 'POST') sent = req.postDataJSON();
    });
    await page.getByPlaceholder(/אבא ואמא חרדים בסלון/).fill('האבא מתמונה 1 והבחור מתמונה 2 בכניסה למכללה');
    await page.getByRole('button', { name: /בחור/ }).first().click();
    await page.getByRole('button', { name: /^אבא/ }).first().click();
    await expect(page.getByText('נבחרו: בחור, אבא', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'צור תמונה' }).click();
    await expect.poll(() => sent).not.toBeNull();
    expect(sent).toMatchObject({ kind: 'image', refs: ['בחור', 'אבא'] });
  });

  test('סרטון במנוע איכות שולח fast=false', async ({ page }) => {
    await page.goto('/creation-studio');
    let sent: Record<string, unknown> | null = null;
    page.on('request', (req) => {
      if (req.url().endsWith('/jobs') && req.method() === 'POST') sent = req.postDataJSON();
    });
    await page.getByRole('tab', { name: /סרטון/ }).click();
    await page.getByPlaceholder(/אולם כנס אקדמי ריק/).fill('אולם ריק');
    await page.getByPlaceholder(/האבא מסתובב לאט/).fill('המצלמה מתקרבת');
    await page.getByRole('button', { name: 'איכות', exact: true }).click();
    await page.getByRole('button', { name: 'צור סרטון' }).click();
    await expect.poll(() => sent).not.toBeNull();
    expect(sent).toMatchObject({ kind: 'video', fast: false });
  });

  test('תיקון תמונה שולח עבודת עריכה עם התמונה שנבחרה', async ({ page }) => {
    await page.goto('/creation-studio');
    let sent: Record<string, unknown> | null = null;
    page.on('request', (req) => {
      if (req.url().endsWith('/jobs') && req.method() === 'POST') sent = req.postDataJSON();
    });
    await page.getByRole('tab', { name: /תיקון תמונה/ }).click();
    await expect(page.getByRole('button', { name: 'תקן' })).toBeDisabled();
    await page.getByTitle('סלון חרדי').click();
    await page.getByPlaceholder('מה לשנות בתמונה').fill('תוריד את העגיל');
    await page.getByRole('button', { name: 'תקן' }).click();
    await expect.poll(() => sent).not.toBeNull();
    expect(sent).toMatchObject({ kind: 'edit', prompt: 'תוריד את העגיל', refs: ['a1'] });
  });

  test('העמוד נטען, מציג מצב, עבודות ואזהרת המחשה', async ({ page }) => {
    await page.goto('/creation-studio');
    await expect(page.getByRole('heading', { name: 'סטודיו יצירה' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('חי-תמלול: פועל')).toBeVisible();
    await expect(page.getByText('נוצר בבינה מלאכותית', { exact: false })).toBeVisible();
    await expect(page.getByText('תמונה · מוכן')).toBeVisible();
    await expect(page.getByText('סרטון · בעבודה')).toBeVisible();
    await expect(page.getByText('קלוד מצא: כיסוי ראש מוסלמי (תוקנה 1 פעמים)')).toBeVisible();
    await expect(page.getByText('העוזר שכותב את התיאור למנוע:')).toBeVisible();
    await page.screenshot({ path: 'test-results/creation-studio.png', fullPage: true });
  });

  test('שליחת תמונה שולחת את התיאור והגודל', async ({ page }) => {
    await page.goto('/creation-studio');
    let sent: Record<string, unknown> | null = null;
    page.on('request', (req) => {
      if (req.url().endsWith('/jobs') && req.method() === 'POST') sent = req.postDataJSON();
    });
    await page.getByRole('button', { name: 'מקומי', exact: true }).click();
    await page.getByPlaceholder(/אבא ואמא חרדים בסלון/).fill('רחוב שקט בבני ברק');
    await page.getByRole('button', { name: 'לאורך 9:16' }).click();
    await page.getByRole('button', { name: 'צור תמונה' }).click();
    await expect.poll(() => sent).not.toBeNull();
    expect(sent).toMatchObject({ kind: 'image', prompt: 'רחוב שקט בבני ברק', width: 720, height: 1280, assist: 'מקומי' });
  });

  test('סרטון מתיאור: צריך גם סצנה וגם תנועה, ונשלח בלי תמונה קיימת', async ({ page }) => {
    await page.goto('/creation-studio');
    let sent: Record<string, unknown> | null = null;
    page.on('request', (req) => {
      if (req.url().endsWith('/jobs') && req.method() === 'POST') sent = req.postDataJSON();
    });
    await page.getByRole('tab', { name: /סרטון/ }).click();
    await page.getByPlaceholder(/האבא מסתובב לאט/).fill('המצלמה מתקרבת לאט');
    await expect(page.getByRole('button', { name: 'צור סרטון' })).toBeDisabled();
    await page.getByPlaceholder(/אולם כנס אקדמי ריק/).fill('אולם כנס ריק');
    await page.getByRole('button', { name: 'צור סרטון' }).click();
    await expect.poll(() => sent).not.toBeNull();
    expect(sent).toMatchObject({ kind: 'video', prompt: 'אולם כנס ריק', motion: 'המצלמה מתקרבת לאט' });
    expect(sent).not.toHaveProperty('from_job');
  });
});
