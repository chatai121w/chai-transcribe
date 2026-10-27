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
  });

  test('העמוד נטען, מציג מצב, עבודות ואזהרת המחשה', async ({ page }) => {
    await page.goto('/creation-studio');
    await expect(page.getByRole('heading', { name: 'סטודיו יצירה' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('חי-תמלול: פועל')).toBeVisible();
    await expect(page.getByText('נוצר בבינה מלאכותית', { exact: false })).toBeVisible();
    await expect(page.getByText('תמונה · מוכן')).toBeVisible();
    await expect(page.getByText('סרטון · בעבודה')).toBeVisible();
    await expect(page.getByText('קלוד מצא: כיסוי ראש מוסלמי (נוצרה מחדש 1 פעמים)')).toBeVisible();
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

  test('בלשונית הסרטון אי אפשר לשלוח בלי לבחור תמונה', async ({ page }) => {
    await page.goto('/creation-studio');
    await page.getByRole('tab', { name: /סרטון מתמונה/ }).click();
    await page.getByPlaceholder(/האבא מסתובב לאט/).fill('המצלמה מתקרבת לאט');
    await expect(page.getByRole('button', { name: 'צור סרטון' })).toBeDisabled();
  });
});
