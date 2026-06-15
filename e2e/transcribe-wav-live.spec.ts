import { test, expect, chromium } from '@playwright/test';
import path from 'path';

test('Login → Upload WAV → Transcribe via CUDA', async () => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--disable-web-security',
      '--disable-features=PrivateNetworkAccessRespectPreflightResults',
      '--allow-insecure-localhost',
    ],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Collect console logs
  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });

  // Monitor network to localhost
  page.on('request', (req) => {
    if (req.url().includes('localhost')) {
      console.log(`>>> ${req.method()} ${req.url()}`);
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('localhost')) {
      console.log(`!!! FAILED: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    }
  });
  page.on('response', (res) => {
    if (res.url().includes('localhost')) {
      console.log(`<<< ${res.status()} ${res.url()}`);
    }
  });

  // ===== 1. LOGIN =====
  console.log('\n========== STEP 1: LOGIN ==========');
  await page.goto('https://smart-hebrew-transcriber.lovable.app/login', {
    waitUntil: 'networkidle', timeout: 30000,
  });

  const emailInput = page.locator('input[type="email"]');
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.fill('jj1212t@gmail.com');
  await page.locator('input[type="password"]').fill('543211');
  await page.locator('button[type="submit"]').click();

  try {
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
  } catch { /* */ }
  await page.waitForTimeout(2000);
  console.log(`Post-login URL: ${page.url()}`);

  // Set whisper_server_url to http://localhost:3000 so the deployed site
  // polls the local CUDA server directly (same as our normalizeServerUrl fix)
  await page.evaluate(() => {
    localStorage.setItem('whisper_server_url', 'http://localhost:3000');
  });
  console.log('Set whisper_server_url = http://localhost:3000');

  // ===== 2. GO TO TRANSCRIBE =====
  console.log('\n========== STEP 2: TRANSCRIBE PAGE ==========');
  await page.goto('https://smart-hebrew-transcriber.lovable.app/transcribe', {
    waitUntil: 'networkidle', timeout: 30000,
  });
  await page.waitForTimeout(3000);

  if (page.url().includes('/login')) {
    console.log('!!! AUTH FAILED !!!');
    await page.screenshot({ path: 'test-results/wav-test-auth-failed.png', fullPage: true });
    await browser.close();
    return;
  }
  console.log(`On: ${page.url()}`);

  // ===== 3. SELECT CUDA ENGINE =====
  console.log('\n========== STEP 3: SELECT CUDA ENGINE ==========');
  // Click on "שרת CUDA" engine card
  const cudaCard = page.locator('text=שרת CUDA').first();
  if (await cudaCard.isVisible().catch(() => false)) {
    await cudaCard.click();
    console.log('Selected CUDA engine');
  } else {
    console.log('CUDA card not found — checking if already selected');
  }
  await page.waitForTimeout(1000);

  // ===== 4. START SERVER IF NEEDED =====
  console.log('\n========== STEP 4: CHECK/START SERVER ==========');
  const startBtn = page.locator('button:has-text("הפעל שרת")');
  if (await startBtn.isVisible().catch(() => false)) {
    console.log('Clicking "הפעל שרת"...');
    await startBtn.click();
    console.log('Waiting for server connection (up to 30s)...');
    
    // Wait for the button to disappear or change (server connected)
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const stillVisible = await startBtn.isVisible().catch(() => false);
      const connected = await page.locator('text=מחובר').first().isVisible().catch(() => false);
      const connecting = await page.locator('text=מתחבר').first().isVisible().catch(() => false);
      console.log(`  ${i+1}s: startBtn=${stillVisible}, connected=${connected}, connecting=${connecting}`);
      if (connected) {
        console.log('SERVER CONNECTED!');
        break;
      }
    }
  } else {
    console.log('Server may already be connected');
  }

  // Take status screenshot
  await page.screenshot({ path: 'test-results/wav-test-before-upload.png', fullPage: true });

  // ===== 5. UPLOAD WAV FILE =====
  console.log('\n========== STEP 5: UPLOAD WAV ==========');
  const wavPath = path.resolve('e2e/fixtures/hebrew_short.wav');
  console.log(`WAV file: ${wavPath}`);

  // Find file input
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count() > 0) {
    await fileInput.setInputFiles(wavPath);
    console.log('File uploaded via input');
  } else {
    // Try drag area or "בחר קובץ" button
    const chooseFileBtn = page.locator('button:has-text("בחר קובץ")');
    if (await chooseFileBtn.isVisible().catch(() => false)) {
      // Use file chooser
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        chooseFileBtn.click(),
      ]);
      await fileChooser.setFiles(wavPath);
      console.log('File uploaded via file chooser');
    } else {
      console.log('!!! No file input found');
    }
  }

  // ===== 6. WAIT FOR TRANSCRIPTION =====
  console.log('\n========== STEP 6: TRANSCRIPTION ==========');
  console.log('Waiting up to 60s for transcription...');

  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    
    // Check for transcription result text
    const resultArea = page.locator('[dir="rtl"]').filter({ hasText: /[\u0590-\u05FF]{3,}/ });
    const hasResult = await resultArea.count() > 0;
    
    // Check for progress indicators
    const progressText = await page.locator('text=/\\d+%/').first().textContent().catch(() => null);
    const phaseText = await page.locator('[class*="phase"], [class*="progress"]').first().textContent().catch(() => null);
    
    if (progressText || phaseText) {
      console.log(`  ${i+1}s: progress=${progressText || '-'} phase=${phaseText || '-'}`);
    }
    
    // Check for error messages
    const errorToast = page.locator('[role="alert"], [data-sonner-toast]').filter({ hasText: /שגיאה|error|נכשל/i });
    if (await errorToast.count() > 0) {
      const errorText = await errorToast.first().textContent().catch(() => 'unknown error');
      console.log(`!!! ERROR: ${errorText}`);
      break;
    }

    // Check for completion
    const transcriptionLogs = logs.filter(l => l.includes('transcri') || l.includes('תמלול'));
    if (transcriptionLogs.length > 0 && i > 5) {
      const lastLog = transcriptionLogs[transcriptionLogs.length - 1];
      if (lastLog.includes('complete') || lastLog.includes('done') || lastLog.includes('הושלם')) {
        console.log('Transcription complete!');
        break;
      }
    }

    if (i % 10 === 9) {
      console.log(`  ${i+1}s: still waiting...`);
    }
  }

  // ===== 7. CAPTURE RESULTS =====
  console.log('\n========== STEP 7: RESULTS ==========');
  
  // Try to find any Hebrew text result
  const hebrewText = await page.evaluate(() => {
    const elements = document.querySelectorAll('p, div, span, textarea');
    const results: string[] = [];
    for (const el of elements) {
      const text = el.textContent || '';
      if (/[\u0590-\u05FF]{10,}/.test(text) && !text.includes('תמלול') && !text.includes('מערכת')) {
        results.push(text.trim().substring(0, 200));
      }
    }
    return results;
  });

  if (hebrewText.length > 0) {
    console.log('=== TRANSCRIPTION RESULT ===');
    for (const t of hebrewText) {
      console.log(t);
    }
    console.log('=== END RESULT ===');
  } else {
    console.log('No transcription result found on page');
  }

  // Final screenshot
  await page.screenshot({ path: 'test-results/wav-test-result.png', fullPage: true });
  console.log('Screenshot saved: test-results/wav-test-result.png');

  // Print all server-related logs
  console.log('\n========== SERVER & TRANSCRIPTION LOGS ==========');
  for (const log of logs) {
    if (log.includes('localhost') || log.includes('8764') || log.includes('3000') ||
        log.includes('transcri') || log.includes('תמלול') || log.includes('CUDA') ||
        log.includes('שרת') || log.includes('upload') || log.includes('model') ||
        log.includes('connect') || log.includes('error') || log.includes('Error') ||
        log.includes('health') || log.includes('Queue')) {
      console.log(log);
    }
  }
  console.log('=== END LOGS ===');

  await context.close();
  await browser.close();
});
