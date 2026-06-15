/**
 * E2E Video Demo — Speaker Diarization (זיהוי דוברים)
 *
 * Records a video showing the full diarization flow:
 *   1. Navigate to /diarization page
 *   2. Upload a 2-speaker Hebrew conversation audio
 *   3. Wait for diarization to complete
 *   4. Verify 2+ speakers detected with Hebrew labels (דובר 1, דובר 2)
 *   5. Show stats, timeline, and transcript tabs
 *
 * Requires:
 *   - Whisper CUDA server running on localhost:3000
 *   - Audio fixture: e2e/fixtures/hebrew_two_speakers.wav
 *
 * Run:
 *   RECORD_VIDEO=1 npx playwright test video-diarization-demo --headed
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
  viewport: { width: 1280, height: 900 },
  locale: 'he-IL',
});

test.describe('דמו וידאו — זיהוי דוברים', () => {
  test.describe.configure({ mode: 'serial' });

  test('זיהוי 2 דוברים בשיחה עברית עם שרת CUDA', async ({ page }) => {
    // Generous timeout for diarization (model load + inference)
    test.setTimeout(720_000);

    // ── Check server ──
    const up = await isServerUp(page);
    test.skip(!up, 'שרת CUDA לא זמין — דלג על דמו');

    // ── Check fixture ──
    const wavPath = path.join(FIXTURES_DIR, 'hebrew_two_speakers.wav');
    if (!fs.existsSync(wavPath)) {
      test.skip(true, 'hebrew_two_speakers.wav fixture not found');
      return;
    }

    // ── Setup ──
    await mockSupabase(page);
    await injectAuthSession(page);

    // Do NOT mock localhost:3000 — we use the real CUDA server

    // ── Capture console errors for debugging ──
    page.on('console', msg => {
      if (msg.type() === 'error') console.log(`[BROWSER ERROR] ${msg.text()}`);
    });
    page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

    // ── Navigate to diarization page ──
    await page.goto('/diarization', { waitUntil: 'domcontentloaded' });

    // Wait for the actual SpeakerDiarization component
    await expect(page.getByRole('heading', { name: 'זיהוי דוברים' })).toBeVisible({ timeout: 30000 });

    // Force local/CUDA mode for deterministic server-backed diarization
    const localModeBtn = page.getByRole('button', { name: /מקומי/ }).first();
    if (await localModeBtn.count()) {
      await localModeBtn.click();
      await page.waitForTimeout(400);
    }

    // Upload area text in the new UI
    await expect(page.getByText(/גרור קובץ אודיו לכאן|לחץ לבחירה/).first()).toBeVisible({ timeout: 15000 });

    // ── Upload the 2-speaker audio ──
    // The file input is hidden but Playwright can interact with it
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(wavPath);

    // ── Wait for completion ──
    // Results include speaker labels and tabs after diarization completes
    await expect(page.getByText(/דובר\s*1|דובר\s*2/).first()).toBeVisible({ timeout: 600000 });
    await page.waitForTimeout(1000);

    // ── Verify at least 2 speakers detected ──
    // Look for "דובר 1" and "דובר 2" labels in the results
    await expect(page.getByText(/דובר\s*1/).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/דובר\s*2/).first()).toBeVisible({ timeout: 5000 });

    console.log('\n══════════════════════════════════════');
    console.log('  ✅ זוהו לפחות 2 דוברים!');
    console.log('══════════════════════════════════════\n');

    // ── Explore tabs for video ──

    // Stats tab (default) — show speaker statistics
    const statsTab = page.getByText('סטטיסטיקות');
    if (await statsTab.count() > 0) {
      await statsTab.first().click();
      await page.waitForTimeout(2000);
    }

    // Timeline tab — show speaker timeline
    const timelineTab = page.getByText('ציר זמן');
    if (await timelineTab.count() > 0) {
      await timelineTab.first().click();
      await page.waitForTimeout(2000);
    }

    // Transcript tab — show diarized transcript
    const transcriptTab = page.getByText('תמלול');
    if (await transcriptTab.count() > 0) {
      await transcriptTab.first().click();
      await page.waitForTimeout(2000);
    }

    // ── Verify Hebrew text in transcript ──
    const pageText = await page.textContent('body');
    const hasHebrew = /[\u0590-\u05FF]{3,}/.test(pageText || '');
    expect(hasHebrew).toBe(true);

    // Check some expected words from the conversation
    const expectedWords = ['שלום', 'רופא', 'תור', 'בוקר', 'טוב'];
    let matchCount = 0;
    for (const word of expectedWords) {
      if (pageText?.includes(word)) matchCount++;
    }

    console.log(`\n══════════════════════════════════════`);
    console.log(`  Word match: ${matchCount}/${expectedWords.length}`);
    console.log(`══════════════════════════════════════\n`);

    // At least 3 out of 5 key words should appear
    expect(matchCount).toBeGreaterThanOrEqual(3);

    // ── Pause for video — show final result ──
    await page.waitForTimeout(3000);

    // ── Log video path ──
    const videoPath = await page.video()?.path();
    if (videoPath) {
      console.log(`\n🎬 Video: ${videoPath}\n`);
    }
  });
});
