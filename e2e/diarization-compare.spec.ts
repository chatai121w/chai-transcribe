/**
 * E2E — Diarization engine comparison (השוואת זיהוי דוברים בין מנועים)
 *
 * Test 1: Full comparison page (/diarization/compare) with pre-loaded data
 * Test 2: Flow test — diarize with "מקומי" + "WhisperX", open full page
 *
 * Run:
 *   npx playwright test diarization-compare
 */

import { test, expect, mockSupabase, injectAuthSession, createTestAudioBuffer } from './helpers';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ── Mock diarization results ── */

const MOCK_ENTRY_LOCAL = {
  label: 'מקומי',
  result: {
    text: 'שלום רב, אני רוצה לקבוע תור אצל הרופא. בוקר טוב, מתי נוח לך להגיע? אני יכול ביום שלישי בשעה עשר בבוקר. מצוין, רשמתי אותך ליום שלישי בעשר.',
    segments: [
      { text: 'שלום רב, אני רוצה לקבוע תור אצל הרופא.', start: 0.0, end: 3.5, speaker: 'SPEAKER_00', speaker_label: 'דובר 1' },
      { text: 'בוקר טוב, מתי נוח לך להגיע?', start: 3.8, end: 6.2, speaker: 'SPEAKER_01', speaker_label: 'דובר 2' },
      { text: 'אני יכול ביום שלישי בשעה עשר בבוקר.', start: 6.5, end: 9.8, speaker: 'SPEAKER_00', speaker_label: 'דובר 1' },
      { text: 'מצוין, רשמתי אותך ליום שלישי בעשר.', start: 10.0, end: 13.0, speaker: 'SPEAKER_01', speaker_label: 'דובר 2' },
    ],
    speakers: ['דובר 1', 'דובר 2'],
    speaker_count: 2,
    duration: 13.0,
    processing_time: 2.4,
    diarization_method: 'silence-gap',
  },
};

const MOCK_ENTRY_WHISPERX = {
  label: 'WhisperX',
  result: {
    text: 'שלום, אני מעוניין לקבוע תור לרופא המשפחה. בוקר טוב, מתי תרצה לבוא? ביום שלישי בשעה עשר יתאים לי. נהדר, קבעתי לך תור ליום שלישי בעשר בבוקר.',
    segments: [
      { text: 'שלום, אני מעוניין לקבוע תור לרופא המשפחה.', start: 0.0, end: 3.6, speaker: 'SPEAKER_00', speaker_label: 'דובר 1' },
      { text: 'בוקר טוב, מתי תרצה לבוא?', start: 3.7, end: 6.0, speaker: 'SPEAKER_01', speaker_label: 'דובר 2' },
      { text: 'ביום שלישי בשעה עשר יתאים לי.', start: 6.4, end: 9.5, speaker: 'SPEAKER_00', speaker_label: 'דובר 1' },
      { text: 'נהדר, קבעתי לך תור ליום שלישי בעשר בבוקר.', start: 9.8, end: 13.0, speaker: 'SPEAKER_01', speaker_label: 'דובר 2' },
    ],
    speakers: ['דובר 1', 'דובר 2'],
    speaker_count: 2,
    duration: 13.0,
    processing_time: 3.1,
    diarization_method: 'whisperx',
  },
};

test.use({
  viewport: { width: 1400, height: 900 },
  locale: 'he-IL',
});

test.describe('השוואת זיהוי דוברים בין מנועים', () => {

  test('עמוד השוואה מלא עם נתונים מוזרקים', async ({ page }) => {
    test.setTimeout(60_000);

    await mockSupabase(page);
    await injectAuthSession(page);

    // Inject compare data into localStorage before navigation
    const entries = [MOCK_ENTRY_LOCAL, MOCK_ENTRY_WHISPERX];
    await page.addInitScript((data) => {
      localStorage.setItem('diarization_compare_entries', JSON.stringify(data));
    }, entries);

    // Navigate to the full comparison page
    await page.goto('/diarization/compare');

    // Verify page loaded — split-screen with both engines
    await expect(page.getByText('השוואת זיהוי דוברים')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('מקומי').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('WhisperX').first()).toBeVisible({ timeout: 10000 });

    // Verify split-screen shows speaker segments from both engines
    await expect(page.getByText('דובר 1').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('דובר 2').first()).toBeVisible({ timeout: 10000 });

    // Verify engine stats are displayed in columns
    await expect(page.getByText('silence-gap').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('whisperx').first()).toBeVisible({ timeout: 10000 });

    // Verify agreement badge
    await expect(page.getByText(/התאמה/).first()).toBeVisible({ timeout: 10000 });

    // Take screenshot of the split-screen view
    const screenshotDir = path.join(__dirname, '..', 'test-results');
    fs.mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, 'compare-page-split.png'), fullPage: true });
    console.log('📸 Screenshot 1: Split-screen view');

    // Enhancement 5: Search bar — type a search query
    const searchInput = page.locator('input[placeholder="חיפוש..."]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill('תור');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(screenshotDir, 'compare-page-search.png'), fullPage: true });
    console.log('📸 Screenshot 2: Search highlighting');
    await searchInput.clear();

    // Enhancement 1: Sync scroll toggle button
    const syncBtn = page.locator('button').filter({ has: page.locator('svg.lucide-arrow-left-right') }).first();
    await expect(syncBtn).toBeVisible({ timeout: 5000 });

    // Enhancement 8: Merge toggle button
    const mergeBtn = page.locator('button').filter({ hasText: 'מיזוג' });
    await expect(mergeBtn).toBeVisible({ timeout: 5000 });
    await mergeBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(screenshotDir, 'compare-page-merge.png'), fullPage: true });
    console.log('📸 Screenshot 3: Merge mode');

    // Enhancement 7: SRT/VTT export buttons visible in engine columns
    await expect(page.getByText('SRT').first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('VTT').first()).toBeVisible({ timeout: 5000 });

    // Open analysis panel — use the specific toolbar button (not the floating sidebar one)
    const analysisBtn = page.locator('button').filter({ hasText: 'ניתוח' }).filter({ has: page.locator('svg') }).last();
    await analysisBtn.click();
    await page.waitForTimeout(500);

    // Verify analysis panel shows diff tabs
    await expect(page.getByText('מטריצת התאמה בין מנועים')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/דמיון/).first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotDir, 'compare-page-analysis.png'), fullPage: true });
    console.log('📸 Screenshot 2: Analysis panel');

    console.log('✅ Full comparison page verified with split-screen + analysis');
  });
});
