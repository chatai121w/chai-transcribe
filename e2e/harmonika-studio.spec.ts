/**
 * E2E — Harmonika Studio (Demucs + WORLD) integration test
 *
 * Uploads a real MP3 file, selects "סטודיו" tier, renders a 10-second preview,
 * and verifies the server returns a valid audio blob.
 *
 * Prerequisites:
 *   - Whisper server running on localhost:3000 with /harmonize endpoint
 *   - Vite dev server running (auto-started by Playwright config on port 8091)
 *   - The MP3 fixture file in the repo root
 */

import { test as base, expect } from '@playwright/test';
import { mockSupabase, injectAuthSession } from './helpers';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const test = base.extend({});

// Skip all tests if the harmony server is not reachable
test.beforeEach(async ({ page }) => {
  let serverOk = false;
  try {
    const res = await page.request.get('http://localhost:3000/harmonize/capabilities');
    const body = await res.json();
    serverOk = body?.tiers?.studio?.available === true;
  } catch { /* server not running */ }
  test.skip(!serverOk, 'Harmony server not running or Studio tier unavailable');

  // Mock Supabase auth so the page loads without login redirect
  await mockSupabase(page);
  await injectAuthSession(page);
});

const MP3_FILE = path.resolve(
  __dirname,
  '..',
  'ישי ריבו ומרדכי בן דוד - אתה זוכר _ Ishay Ribo _ MBD - Ata Zocher_2.mp3',
);

test.describe('Harmonika Studio — Demucs separation', () => {
  test('uploads MP3, selects Studio, and renders preview successfully', async ({ page }) => {
    // Increase timeout — Demucs separation can take a while
    test.setTimeout(180_000);

    await page.goto('/harmonika');
    await expect(page.locator('h1')).toContainText('הרמוניקיה');

    // Step 1: Upload the MP3 file (quality pills only appear after upload)
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(MP3_FILE);

    // Wait for filename to appear confirming upload
    await expect(page.getByText('אתה זוכר')).toBeVisible({ timeout: 5_000 });

    // Wait for capabilities to load — Studio pill should appear
    const studioBtn = page.getByRole('button', { name: /סטודיו.*★★★/ });
    await expect(studioBtn).toBeVisible({ timeout: 10_000 });

    // Auto-selects best tier, but click to be sure
    await studioBtn.click();

    // Verify Studio explanation text appears
    await expect(page.getByText('הפרדת שירה')).toBeVisible();

    // Click Preview (10 seconds)
    const previewBtn = page.getByRole('button', { name: /תצוגה מקדימה/ });
    await expect(previewBtn).toBeEnabled();
    await previewBtn.click();

    // Wait for processing overlay to appear
    await expect(page.getByText('יוצר תצוגה מקדימה')).toBeVisible({ timeout: 5_000 });

    // Wait for processing to finish — Demucs can take up to 2 minutes
    await expect(page.getByText('יוצר תצוגה מקדימה')).toBeHidden({ timeout: 150_000 });

    // Verify no error appeared
    await expect(page.locator('.text-destructive')).toBeHidden();

    // Verify the preview player appeared
    await expect(page.locator('span').filter({ hasText: /תצוגה מקדימה/ })).toBeVisible();

    console.log('✅ Studio (Demucs + WORLD) preview rendered successfully!');
  });

  test('all 3 server tiers are available', async ({ page }) => {
    await page.goto('/harmonika');
    await expect(page.locator('h1')).toContainText('הרמוניקיה');

    // Upload a file first — quality pills only show after upload
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(MP3_FILE);
    await expect(page.getByText('אתה זוכר')).toBeVisible({ timeout: 5_000 });

    // Wait for capabilities to load
    await expect(page.getByRole('button', { name: /סטודיו.*★★★/ })).toBeVisible({ timeout: 10_000 });

    // Verify all 4 tier buttons are visible
    await expect(page.getByRole('button', { name: /דפדפן/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /בסיסי.*★/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /פרו.*★★/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /סטודיו.*★★★/ })).toBeVisible();

    // Verify none show "לא זמין" (all should be available)
    const unavailable = page.getByText('(לא זמין)');
    await expect(unavailable).toHaveCount(0);

    console.log('✅ All 3 server tiers + browser tier are available');
  });

  test('switching tiers updates explanation text', async ({ page }) => {
    await page.goto('/harmonika');

    // Upload file first
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(MP3_FILE);
    await expect(page.getByText('אתה זוכר')).toBeVisible({ timeout: 5_000 });

    // Wait for quality pills
    await expect(page.getByRole('button', { name: /סטודיו.*★★★/ })).toBeVisible({ timeout: 10_000 });

    // Click browser
    await page.getByRole('button', { name: /דפדפן/ }).click();
    await expect(page.getByText('עיבוד מהיר ישירות בדפדפן')).toBeVisible();

    // Click basic
    await page.getByRole('button', { name: /בסיסי.*★/ }).click();
    await expect(page.getByText('שמירת צליל הפורמנטים')).toBeVisible();

    // Click pro
    await page.getByRole('button', { name: /פרו.*★★/ }).click();
    await expect(page.getByText('שומר על טבעיות הקול')).toBeVisible();

    // Click studio
    await page.getByRole('button', { name: /סטודיו.*★★★/ }).click();
    await expect(page.getByText('הפרדת שירה')).toBeVisible();

    console.log('✅ Tier switching updates explanation correctly');
  });
});
