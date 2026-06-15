import { test } from '@playwright/test';

test('simple nav to 127.0.0.1:8083', async ({ page }) => {
  page.on('request', r => console.log('REQ', r.url().substring(0, 100)));
  page.on('requestfailed', r => console.log('FAIL', r.url().substring(0, 100), r.failure()?.errorText));
  page.on('response', r => console.log('RES', r.status(), r.url().substring(0, 100)));
  
  const resp = await page.goto('http://127.0.0.1:8083/', { timeout: 15000 });
  console.log('status:', resp?.status());
  console.log('title:', await page.title());
});
