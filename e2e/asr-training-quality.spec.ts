import { expect, test, injectAuthSession, mockLocalServer, mockSupabase } from './helpers';

test.describe('Torah ASR training quality controls', () => {
  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
    await mockLocalServer(page, { connected: true });
    await page.route('**/whisper/training/datasets', (route) => route.fulfill({
      status: 200,
      json: {
        datasets: [{
          dataset_id: 'approved-ground-truth', count: 24, has_manifest: true,
          train_count: 20, eval_count: 4, recording_groups: 3, duration_seconds: 240,
          ready_for_training: true,
          quality_counts: { gold: 18, silver: 4, bronze: 2, unknown: 0 },
          label_source_counts: { 'human-approved': 18, 'teacher-consensus': 4, 'reference-audio-import': 2 },
        }],
      },
    }));
    await page.route('**/whisper/training/jobs', (route) => route.fulfill({
      status: 200,
      json: {
        jobs: [{
          job_id: 'gemara-v2', status: 'done', progress: 100,
          wer_before: 30, wer_after: 24, cer_before: 12, cer_after: 13,
          eval_sample_count: 4, eval_fingerprint: 'fixed-holdout',
          quality_gate: false, quality_gate_reasons: ['holdout CER regressed'],
          ct2_model_path: 'C:/models/gemara-v2',
        }],
      },
    }));
    await page.route('**/whisper/training/active-model', (route) => route.fulfill({ status: 200, json: { active: null } }));
  });

  test('shows one persisted Gemini teacher and blocks a regressing LoRA model', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/compare?tab=ground-truth', { waitUntil: 'commit', timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /אימון תמלול/ })).toBeVisible({ timeout: 30_000 });
    const rtlSurface = page.locator('div[dir="rtl"]').filter({ has: page.getByRole('heading', { name: /אימון תמלול/ }) }).first();
    await expect(rtlSurface).toHaveCSS('direction', 'rtl');

    await expect(page.getByText('Gemini כמנוע מורה להשוואה')).toHaveCount(1);
    const geminiToggle = page.locator('#eng-gemini');
    await expect(geminiToggle).toHaveAttribute('data-state', 'unchecked');
    await geminiToggle.click();
    await expect(geminiToggle).toHaveAttribute('data-state', 'checked');
    const geminiRow = page.getByText('Gemini כמנוע מורה להשוואה').locator('..');
    await geminiRow.getByRole('combobox').click();
    await expect(page.getByRole('option', { name: /Gemini 3.5 Transcribe/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await expect(page.locator('#eng-gemini')).toHaveAttribute('data-state', 'checked');

    await page.getByRole('button', { name: /approved-ground-truth/ }).click();
    await expect(page.getByText(/Gold: 18/)).toBeVisible();
    await expect(page.getByText(/Silver: 4/)).toBeVisible();
    await expect(page.getByText(/CER לפני:.*12\.00%/)).toBeVisible();
    await expect(page.getByText(/CER אחרי:.*13\.00%/)).toBeVisible();
    await expect(page.getByText(/לא הופעל: holdout CER regressed/)).toBeVisible();

    const activate = page.getByRole('button').filter({ has: page.locator('svg.lucide-power') });
    await expect(activate).toBeDisabled();
    expect(pageErrors).toEqual([]);
  });
});
