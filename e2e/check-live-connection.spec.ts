import { test, expect, chromium } from '@playwright/test';

test('Login and verify CUDA server connection via console', async () => {
  // Launch with web security disabled to bypass PNA blocking
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-web-security',
      '--disable-features=PrivateNetworkAccessRespectPreflightResults,PrivateNetworkAccessForWorkers,PrivateNetworkAccessForNavigations',
      '--allow-insecure-localhost',
    ],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Collect all console messages
  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });

  // Monitor network requests to localhost
  page.on('request', (req) => {
    if (req.url().includes('localhost')) {
      console.log(`>>> NET REQUEST: ${req.method()} ${req.url()}`);
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('localhost')) {
      console.log(`!!! NET FAILED: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    }
  });
  page.on('response', (res) => {
    if (res.url().includes('localhost')) {
      console.log(`<<< NET RESPONSE: ${res.status()} ${res.url()}`);
    }
  });

  // Navigate to login
  console.log('--- Navigating to login page ---');
  await page.goto('https://smart-hebrew-transcriber.lovable.app/login', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForTimeout(2000);

  // Fill login form
  console.log('--- Filling login form ---');
  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.fill('jj1212t@gmail.com');
  const passwordInput = page.locator('input[type="password"]');
  await passwordInput.fill('543211');

  // Submit
  await page.locator('button[type="submit"]').click();
  console.log('--- Credentials submitted ---');

  // Wait for auth redirect
  try {
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
  } catch { /* ignore */ }
  await page.waitForTimeout(2000);
  console.log(`--- Post-login URL: ${page.url()} ---`);

  // Go to transcribe
  await page.goto('https://smart-hebrew-transcriber.lovable.app/transcribe', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForTimeout(5000);
  console.log(`--- Transcribe URL: ${page.url()} ---`);

  if (page.url().includes('/login')) {
    console.log('!!! AUTH FAILED !!!');
    await context.close();
    return;
  }

  // Wait for automatic connection checks
  console.log('--- Waiting 10s for auto-connection checks... ---');
  await page.waitForTimeout(10000);

  // Click "הפעל שרת" if visible
  const startServerBtn = page.locator('button:has-text("הפעל שרת")');
  if (await startServerBtn.isVisible().catch(() => false)) {
    console.log('--- Clicking "הפעל שרת" ---');
    await startServerBtn.first().click();
    console.log('--- Waiting 20s for server connection... ---');
    await page.waitForTimeout(20000);
  } else {
    console.log('--- "הפעל שרת" button NOT visible (may already be connected) ---');
  }

  // Print server-related logs
  console.log('\n=== SERVER LOGS ===');
  for (const log of logs) {
    if (log.includes('Server') || log.includes('server') || log.includes('CUDA') ||
        log.includes('localhost') || log.includes('מחובר') || log.includes('נגיש') ||
        log.includes('connection') || log.includes('health') || log.includes('Queue') ||
        log.includes('8764') || log.includes('3000') || log.includes('שרת') ||
        log.includes('error') || log.includes('Error') || log.includes('fetch')) {
      console.log(log);
    }
  }
  console.log('=== END ===\n');

  await page.screenshot({ path: 'test-results/live-connection-check.png', fullPage: true });
  console.log('--- Screenshot saved ---');
  console.log(`--- Final URL: ${page.url()} ---`);

  await context.close();
  await browser.close();
});
