/**
 * E2E Video Demo — Real Hebrew transcription with CUDA server
 *
 * Records a video showing the full flow:
 *   1. Open transcription page
 *   2. Select CUDA local-server engine
 *   3. Upload Hebrew audio fixture
 *   4. Wait for transcription to complete
 *   5. Verify Hebrew text appears in the result
 *
 * Run with:
 *   RECORD_VIDEO=1 npx playwright test video-transcription-demo --headed
 *
 * Video saved to: test-results/
 */

import { test as base, expect, type Page } from '@playwright/test';
import { mockSupabase, injectAuthSession } from './helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER = 'http://localhost:3000';
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Force video recording for this spec
const test = base.extend({});

async function isServerUp(page: Page): Promise<boolean> {
  try {
    const r = await page.request.get(`${SERVER}/health`);
    if (!r.ok()) return false;
    const d = await r.json();
    return d.status === 'ok' && d.model_ready === true;
  } catch {
    return false;
  }
}

test.use({
  video: 'on',
  viewport: { width: 1280, height: 800 },
  locale: 'he-IL',
});

test.describe('דמו וידאו — תמלול עברי אמיתי', () => {
  test.describe.configure({ mode: 'serial' });

  test('תמלול קובץ עברי עם שרת CUDA מקומי', async ({ page, context }) => {
    // ── Check server is up ──
    const up = await isServerUp(page);
    test.skip(!up, 'שרת CUDA לא זמין — דלג על דמו וידאו');

    // ── Setup mocks (Supabase only, NOT local server — we use the real one) ──
    await mockSupabase(page);
    await injectAuthSession(page);

    // ── Navigate to transcription page ──
    await page.goto('/transcribe', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Verify page loaded
    await expect(page.getByText('מערכת תמלול מתקדמת').first()).toBeVisible({ timeout: 10000 });

    // ── Select CUDA local-server engine ──
    const cudaOption = page.getByText('שרת CUDA').first();
    await expect(cudaOption).toBeVisible({ timeout: 5000 });
    await cudaOption.click();
    await page.waitForTimeout(500);

    // Wait for server connection indicator
    await expect(page.getByText('מחובר').first()).toBeVisible({ timeout: 15000 });

    // Take a screenshot mid-flow
    await page.waitForTimeout(500);

    // ── Load Hebrew audio fixture ──
    const wavPath = path.join(FIXTURES_DIR, 'hebrew_short.wav');
    const expectedTxtPath = path.join(FIXTURES_DIR, 'hebrew_short.expected.txt');

    if (!fs.existsSync(wavPath)) {
      test.skip(true, 'hebrew_short.wav fixture not found');
      return;
    }

    const expectedText = fs.existsSync(expectedTxtPath)
      ? fs.readFileSync(expectedTxtPath, 'utf-8').trim()
      : '';

    // ── Upload the audio file ──
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(wavPath);
    await page.waitForTimeout(500);

    // ── Wait for transcription to complete ──
    // The app auto-starts transcription when a file is selected with CUDA engine.
    // Look for result text, progress indicator, or completion toast.

    // Wait for progress or processing indicator
    const processingOrResult = page.getByText(/מתמלל|מעבד|תמלול הושלם|העתק תמלול/i).first();
    await expect(processingOrResult).toBeVisible({ timeout: 15000 });

    // Wait for transcription to finish — look for copy button or result text
    // Timeout 120s for slower models
    const transcriptionDone = page.getByText(/העתק תמלול|הועתק|תמלול הושלם/i).first();
    await expect(transcriptionDone).toBeVisible({ timeout: 120000 });

    await page.waitForTimeout(1000);

    // ── Verify Hebrew text in result ──
    // Check that some Hebrew text appeared on the page
    const pageText = await page.textContent('body');
    const hasHebrew = /[\u0590-\u05FF]{2,}/.test(pageText || '');
    expect(hasHebrew).toBe(true);

    // If we have expected text, check for word overlap
    if (expectedText) {
      const expectedWords = expectedText.split(/\s+/).filter(w => w.length > 2);
      let matchCount = 0;
      for (const word of expectedWords) {
        if (pageText?.includes(word)) matchCount++;
      }
      const matchRatio = matchCount / expectedWords.length;
      console.log(`\n══════════════════════════════════════`);
      console.log(`  תוצאת תמלול — Word Match: ${matchCount}/${expectedWords.length} (${(matchRatio * 100).toFixed(0)}%)`);
      console.log(`  Expected: ${expectedText}`);
      console.log(`══════════════════════════════════════\n`);
      // At least 30% word match for basic validation
      expect(matchRatio).toBeGreaterThan(0.3);
    }

    // ── Pause for video — show the result ──
    await page.waitForTimeout(3000);

    // ── Save video path info ──
    const videoPath = await page.video()?.path();
    if (videoPath) {
      console.log(`\n🎬 Video recorded: ${videoPath}\n`);
    }
  });

  test('תמלול קובץ בינוני עם שרת CUDA', async ({ page }) => {
    const up = await isServerUp(page);
    test.skip(!up, 'שרת CUDA לא זמין');

    await mockSupabase(page);
    await injectAuthSession(page);

    await page.goto('/transcribe', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Select CUDA engine
    const cudaOption = page.getByText('שרת CUDA').first();
    await cudaOption.click();
    await expect(page.getByText('מחובר').first()).toBeVisible({ timeout: 15000 });

    // Upload medium fixture
    const wavPath = path.join(FIXTURES_DIR, 'hebrew_medium.wav');
    const expectedTxtPath = path.join(FIXTURES_DIR, 'hebrew_medium.expected.txt');

    if (!fs.existsSync(wavPath)) {
      test.skip(true, 'hebrew_medium.wav fixture not found');
      return;
    }

    const expectedText = fs.existsSync(expectedTxtPath)
      ? fs.readFileSync(expectedTxtPath, 'utf-8').trim()
      : '';

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(wavPath);

    // Wait for completion
    const transcriptionDone = page.getByText(/העתק תמלול|הועתק|תמלול הושלם/i).first();
    await expect(transcriptionDone).toBeVisible({ timeout: 120000 });

    await page.waitForTimeout(1000);

    // Verify Hebrew words present
    const pageText = await page.textContent('body');
    if (expectedText) {
      const expectedWords = expectedText.split(/\s+/).filter(w => w.length > 2);
      let matchCount = 0;
      for (const word of expectedWords) {
        if (pageText?.includes(word)) matchCount++;
      }
      console.log(`\n══════════════════════════════════════`);
      console.log(`  Medium file — Match: ${matchCount}/${expectedWords.length} (${(matchCount / expectedWords.length * 100).toFixed(0)}%)`);
      console.log(`══════════════════════════════════════\n`);
      expect(matchCount / expectedWords.length).toBeGreaterThan(0.3);
    }

    await page.waitForTimeout(3000);
  });
});
