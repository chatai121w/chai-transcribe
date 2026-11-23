import { chromium, type FullConfig } from '@playwright/test';

/**
 * חימום שרת הפיתוח לפני כל הבדיקות.
 *
 * במצב פיתוח כל קובץ מקור מהודר בפעם הראשונה שמבקשים אותו, ובפרויקט
 * הזה יש יותר ממאתיים כאלה. התוצאה: הבדיקה הראשונה שרצה משלמת את
 * המחיר כולו ונכשלת על דף שעוד לא הספיק להיבנות, בעוד שהבדיקה
 * שאחריה — על אותו קוד בדיוק — עוברת.
 *
 * נמדד: דף ההתחברות לא הציג אף שדה אחרי חמש-עשרה שניות בהרצה קרה,
 * והציג את כולם מיד בהרצה שאחריה. זה מה שגרם לכשלים ההפכפכים
 * בבדיקות ההתחברות והתמלול, שנראו כאילו תוכן חסר בדף.
 *
 * כאן נטענים פעם אחת הדפים הכבדים, לפני שהבדיקות מתחילות. העלות
 * חד-פעמית, וכל הבדיקות מתחילות אחריה על שרת חם.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.PLAYWRIGHT_SKIP_WARMUP === '1') return;

  const baseURL = config.projects[0]?.use?.baseURL;
  // מול אתר חי או בנוי אין הידור ואין מה לחמם
  if (!baseURL || !baseURL.includes('localhost')) return;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const started = Date.now();

  try {
    // דף ההתחברות מושך את רוב קוד הבסיס. ממתינים עד שהטופס עצמו קיים.
    await page.goto(new URL('/login', baseURL).toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    });
    await page.waitForSelector('input', { timeout: 180_000 });

    // שאר הדפים הכבדים — הקוד המשותף כבר מהודר, נשאר רק הייחודי להם
    for (const path of ['/transcribe', '/video-to-mp3', '/editor']) {
      await page
        .goto(new URL(path, baseURL).toString(), { waitUntil: 'domcontentloaded', timeout: 120_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1_500);
    }

    // eslint-disable-next-line no-console
    console.log(`[חימום] שרת הפיתוח מוכן אחרי ${Math.round((Date.now() - started) / 1000)} שניות`);
  } catch (error) {
    // חימום שנכשל אינו סיבה לעצור את כל הבדיקות — הן פשוט יתחילו קרות
    // eslint-disable-next-line no-console
    console.log(`[חימום] לא הושלם: ${error instanceof Error ? error.message : error}`);
  } finally {
    await browser.close();
  }
}
