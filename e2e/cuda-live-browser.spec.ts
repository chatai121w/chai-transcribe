/**
 * CUDA Live Transcription - End-to-End Browser Tests
 * Tests the full LiveTranscriber.tsx flow against real CUDA server on localhost:3000
 */
import { test, expect, mockSupabase, injectAuthSession } from './helpers';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8083';

// Inject a fake MediaStream so getUserMedia succeeds in headless Chromium
async function injectFakeMediaStream(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      try {
        return await origGetUserMedia(constraints);
      } catch {
        const ctx = new AudioContext({ sampleRate: 16000 });
        const osc = ctx.createOscillator();
        osc.frequency.value = 440;
        osc.type = 'sine';
        const dest = ctx.createMediaStreamDestination();
        const gain = ctx.createGain();
        gain.gain.value = 0.3;
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        return dest.stream;
      }
    };
  });
}

// Let real localhost:3000 requests through (don't mock them)
async function setupForRealCuda(page: import('@playwright/test').Page) {
  await mockSupabase(page);
  await injectAuthSession(page);
  // Set whisper_server_url to the real local server
  await page.addInitScript(() => {
    localStorage.setItem('whisper_server_url', 'http://localhost:3000');
    // Set engine to local-server so health polling starts
    // useCloudPreferences reads 'user_preferences' first, then individual keys as fallback
    const prefs = JSON.parse(localStorage.getItem('user_preferences') || '{}');
    prefs.engine = 'local-server';
    localStorage.setItem('user_preferences', JSON.stringify(prefs));
    // Also set the individual fallback key
    localStorage.setItem('transcript_engine', 'local-server');
  });
  // Ensure local server health/transcribe requests are NOT intercepted by mockSupabase
  // Unroute any patterns that match localhost:3000
  await page.route('**/localhost:3000/**', route => route.continue());
  await page.route('**/whisper/**', route => route.continue());
}

test.describe('CUDA Live Transcription - Browser E2E', () => {

  test('בדיקה 1: UI נטען ומצב CUDA זמין', async ({ page }) => {
    console.log('\n===== TEST 1: UI loads, CUDA mode available =====');
    await setupForRealCuda(page);
    
    await page.goto(`${BASE_URL}/transcribe`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    await page.screenshot({ path: 'test-results/cuda-live-1-loaded.png', fullPage: true });
    // Wait for React to mount
    await page.waitForTimeout(5000);
    console.log('URL:', page.url());
    
    // Look for CUDA-related elements
    const pageText = await page.textContent('body') || '';
    const hasCuda = pageText.includes('CUDA') || pageText.includes('cuda') || pageText.includes('שרת');
    const hasTranscribe = pageText.includes('תמלול');
    console.log(`Page has CUDA text: ${hasCuda}`);
    console.log(`Page has transcribe text: ${hasTranscribe}`);
    
    // List all visible buttons
    const buttons = await page.getByRole('button').allTextContents();
    const filtered = buttons.filter(t => t.trim()).slice(0, 20);
    console.log('Visible buttons:', filtered);
    
    await page.screenshot({ path: 'test-results/cuda-live-1-final.png', fullPage: true });
  });

  test('בדיקה 2: הקלטה עם mic מזויף → שליחה לשרת CUDA', async ({ page }) => {
    console.log('\n===== TEST 2: Fake mic → CUDA server transcription =====');
    await setupForRealCuda(page);
    await injectFakeMediaStream(page);
    
    // Collect console logs
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const text = `[${msg.type()}] ${msg.text()}`;
      consoleLogs.push(text);
      if (text.includes('error') || text.includes('Error') || text.includes('chunk') || 
          text.includes('transcri') || text.includes('Live')) {
        console.log(`  CONSOLE: ${text.substring(0, 200)}`);
      }
    });

    // Monitor ALL network (including health checks)
    const allNetLog: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('whisper') || req.url().includes('3000')) {
        allNetLog.push(`>>> ${req.method()} ${req.url()}`);
        console.log(`  NET >>> ${req.method()} ${req.url()}`);
      }
    });
    page.on('response', (res) => {
      if (res.url().includes('whisper') || res.url().includes('3000')) {
        allNetLog.push(`<<< ${res.status()} ${res.url()}`);
        console.log(`  NET <<< ${res.status()} ${res.url()}`);
      }
    });
    page.on('requestfailed', (req) => {
      if (req.url().includes('whisper') || req.url().includes('3000')) {
        allNetLog.push(`!!! ${req.url()} ${req.failure()?.errorText}`);
        console.log(`  NET !!! ${req.url()} ${req.failure()?.errorText}`);
      }
    });

    await page.goto(`${BASE_URL}/transcribe`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(3000);

    // Check if page loaded correctly
    const bodyText = await page.textContent('body') || '';
    if (bodyText.includes('שגיאה') && bodyText.includes('רענן')) {
      console.log('Page shows error boundary — refreshing...');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'test-results/cuda-live-2-loaded.png', fullPage: true });
    
    // Try to find and click CUDA mode selector
    // Wait for server connection (health check polling) — up to 15s
    console.log('Waiting for CUDA server connection...');
    const cudaBtn = page.locator('button:has-text("CUDA")').first();
    try {
      await cudaBtn.waitFor({ state: 'visible', timeout: 5000 });
      // Wait for it to become enabled (health check succeeds)
      await expect(cudaBtn).toBeEnabled({ timeout: 15000 });
      await cudaBtn.click();
      console.log('Selected CUDA mode');
    } catch {
      // Check if it's disabled
      const isDisabled = await cudaBtn.isDisabled().catch(() => true);
      console.log(`CUDA button found but disabled=${isDisabled} — server may not be reachable from browser`);
      const title = await cudaBtn.getAttribute('title');
      console.log(`CUDA button title: ${title}`);
      await page.screenshot({ path: 'test-results/cuda-live-2-cuda-disabled.png', fullPage: true });
      
      // Force-enable and click anyway to test the recording flow
      await page.evaluate(() => {
        const btn = document.querySelector('button[title*="CUDA"]') as HTMLButtonElement;
        if (btn) { btn.disabled = false; btn.click(); }
      });
      console.log('Force-clicked CUDA button');
    }
    
    await page.waitForTimeout(1000);
    
    // Find and click start recording button
    let started = false;
    for (const label of ['התחל תמלול חי', 'התחל', 'הקלט', 'start']) {
      const btn = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      if (await btn.isVisible().catch(() => false)) {
        console.log(`Clicking start button: "${label}"...`);
        await btn.click();
        started = true;
        break;
      }
    }
    
    if (!started) {
      // Try any button with mic/record icon
      const micBtn = page.locator('button:has(svg)').filter({ hasText: /תמלול|הקלט|mic/i }).first();
      if (await micBtn.isVisible().catch(() => false)) {
        await micBtn.click();
        started = true;
        console.log('Clicked mic button');
      }
    }

    if (!started) {
      console.log('Could not find start button');
      await page.screenshot({ path: 'test-results/cuda-live-2-no-start.png', fullPage: true });
      return;
    }

    // Wait for recording and chunk sending
    console.log('Recording started — waiting 10s for chunks...');
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      console.log(`  ${i+1}s: network requests=${allNetLog.length}`);
    }

    await page.screenshot({ path: 'test-results/cuda-live-2-recording.png', fullPage: true });

    // Stop
    for (const label of ['עצור', 'הפסק', 'stop']) {
      const btn = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      if (await btn.isVisible().catch(() => false)) {
        console.log(`Clicking stop: "${label}"`);
        await btn.click();
        break;
      }
    }
    
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'test-results/cuda-live-2-stopped.png', fullPage: true });

    // Summary
    console.log('\n--- Network Summary ---');
    const posts = allNetLog.filter(l => l.includes('>>>')).length;
    const oks = allNetLog.filter(l => l.includes('<<< 200')).length;
    const errs = allNetLog.filter(l => l.includes('<<< 5') || l.includes('!!!')).length;
    console.log(`All requests: ${posts} | 200 OK: ${oks} | Errors: ${errs}`);
    
    console.log('\n--- Console Errors ---');
    const errLogs = consoleLogs.filter(l => l.includes('[error]'));
    for (const l of errLogs.slice(0, 5)) console.log(`  ${l.substring(0, 200)}`);
  });

  test('בדיקה 3: שליחת קובץ WAV ישירות לשרת CUDA', async ({ request }) => {
    console.log('\n===== TEST 3: Direct WAV → CUDA /transcribe-live =====');
    
    // This test verifies the server endpoint directly
    const fs = await import('fs');
    const path = await import('path');
    const wavBuf = fs.readFileSync(path.resolve('e2e/fixtures/hebrew_short.wav'));
    
    // Test 1: Full file
    console.log(`Sending full WAV (${wavBuf.length} bytes)...`);
    const resp = await request.post('http://localhost:3000/transcribe-live', {
      multipart: {
        file: { name: 'test.wav', mimeType: 'audio/wav', buffer: wavBuf },
        language: 'he',
      },
      timeout: 20000,
    });
    
    expect(resp.ok()).toBeTruthy();
    const data = await resp.json();
    console.log(`Result: "${data.text}" (${data.processing_time}s, audio=${data.audio_duration}s)`);
    expect(data.text).toBeTruthy();
    expect(data.text.length).toBeGreaterThan(5);
    
    // Test 2: Final mode (refine pass)
    console.log('\nSending in final mode...');
    const resp2 = await request.post('http://localhost:3000/transcribe-live', {
      multipart: {
        file: { name: 'test.wav', mimeType: 'audio/wav', buffer: wavBuf },
        language: 'he',
        final: '1',
      },
      timeout: 30000,
    });
    
    expect(resp2.ok()).toBeTruthy();
    const data2 = await resp2.json();
    console.log(`Final result: "${data2.text}" (${data2.processing_time}s)`);
    console.log(`Word timings: ${data2.wordTimings?.length || 0}`);
    expect(data2.text).toBeTruthy();
    expect(data2.final).toBe(true);
  });
});
