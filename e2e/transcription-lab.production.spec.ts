import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loadEnv } from 'vite';

const PROJECT_ENV = loadEnv('production', process.cwd(), '');
const RUN_PRODUCTION = process.env.RUN_PRODUCTION_LAB === '1';
const APP_URL = process.env.PRODUCTION_APP_URL || PROJECT_ENV.PRODUCTION_APP_URL || 'https://chai-transcribe.lovable.app';
const SOURCE_QUERY = process.env.PRODUCTION_LAB_SOURCE_QUERY || 'שמות, בין שמות';
const CANDIDATE_ENGINE = process.env.PRODUCTION_LAB_CANDIDATE_ENGINE === 'local-server' ? 'local-server' : 'gemini';
const CANDIDATE_ENGINE_LABEL = CANDIDATE_ENGINE === 'local-server' ? 'CUDA מקומי' : 'Gemini';
const CANDIDATE_MODEL_LABEL = CANDIDATE_ENGINE === 'local-server' ? 'Ivrit.ai Turbo V3' : 'Gemini 3.5 Transcribe';
const EVIDENCE_FILE = `logs/qa/transcription-lab-production-${CANDIDATE_ENGINE === 'local-server' ? 'cuda' : 'gemini'}.json`;

interface ProductionEvidence {
  experimentId: string;
  sourceTranscriptId: string;
  localEventCount: number;
  cloudEventCount: number;
  cloudRunCount: number;
  stages: string[];
  baselineWords: number;
  candidateWords: number;
  baselineModel: string | null;
  candidateModel: string | null;
  baselineRequestedModel: string | null;
  candidateRequestedModel: string | null;
  baselineProvider: string | null;
  candidateProvider: string | null;
  baselineFallbackReason: string | null;
  candidateFallbackReason: string | null;
  baselineTimingCount: number;
  candidateTimingCount: number;
  traceValid: boolean;
  traceValidationErrors: unknown[];
  sourceSelectionAttempts: number;
  expectedNavigationAborts: number;
  sourceUploadCount: number;
  goldCountBefore: number;
  goldCountAfter: number;
  lexiconCountBefore: number;
  lexiconCountAfter: number;
  cleanup: { events: number; runs: number };
}

function required(name: string): string {
  const value = (process.env[name] || PROJECT_ENV[name])?.trim();
  if (!value) throw new Error(`Missing required production-test variable: ${name}`);
  return value;
}

async function authenticateAdmin(): Promise<SupabaseClient> {
  const client = createClient(required('VITE_SUPABASE_URL'), required('VITE_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: required('E2E_EMAIL'),
    password: required('E2E_PASSWORD'),
  });
  if (error) throw error;
  return client;
}

async function exactCount(client: SupabaseClient, table: string, configure?: (query: any) => any): Promise<number> {
  let query = client.from(table).select('*', { count: 'exact', head: true });
  if (configure) query = configure(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function cleanupExperiment(client: SupabaseClient, experimentId: string): Promise<{ events: number; runs: number }> {
  const { data: runs, error: runReadError } = await client
    .from('comparison_runs')
    .select('id,config_snapshot')
    .contains('config_snapshot', { experimentId });
  if (runReadError) throw runReadError;
  const runIds = (runs || []).map((run) => run.id);

  const { error: eventDeleteError } = await client
    .from('asr_pipeline_events')
    .delete()
    .eq('experiment_id', experimentId);
  if (eventDeleteError) throw eventDeleteError;

  if (runIds.length) {
    const { error: runDeleteError } = await client.from('comparison_runs').delete().in('id', runIds);
    if (runDeleteError) throw runDeleteError;
  }

  const eventsLeft = await exactCount(client, 'asr_pipeline_events', (query) => query.eq('experiment_id', experimentId));
  const runsLeft = await exactCount(client, 'comparison_runs', (query) => query.contains('config_snapshot', { experimentId }));
  expect(eventsLeft).toBe(0);
  expect(runsLeft).toBe(0);
  return { events: eventsLeft, runs: runsLeft };
}

test.describe('Production transcription lab acceptance', () => {
  test.skip(!RUN_PRODUCTION, 'Set RUN_PRODUCTION_LAB=1 to run the isolated production acceptance test.');
  test.describe.configure({ mode: 'serial' });

  test('runs a real cloud-backed A/B, persists a complete trace, and cleans up its own data', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    const client = await authenticateAdmin();
    let experimentId = '';
    let evidence: ProductionEvidence | null = null;
    const sourceUploads: string[] = [];
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const failedApiRequests: string[] = [];
    let expectedNavigationAborts = 0;
    let sourceSelectionAttempts = 0;

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/storage/v1/object/permanent-audio/')) {
        sourceUploads.push(request.url().split('?')[0]);
      }
    });
    page.on('requestfailed', (request) => {
      const url = request.url();
      const failure = request.failure()?.errorText || 'unknown';
      if ((request.resourceType() === 'fetch' || request.resourceType() === 'xhr') && failure.includes('ERR_ABORTED')) {
        expectedNavigationAborts += 1;
      }
      if ((request.resourceType() === 'fetch' || request.resourceType() === 'xhr')
          && !url.includes('/realtime/')
          && !url.includes('fonts.googleapis.com')
          && !failure.includes('ERR_ABORTED')) {
        failedApiRequests.push(`${request.method()} ${url.split('?')[0]}: ${failure}`);
      }
    });

    const goldCountBefore = await exactCount(client, 'transcripts', (query) => query.contains('tags', ['asr-gold-source']));
    const lexiconCountBefore = await exactCount(client, 'torah_lexicon_terms');

    try {
      await page.goto(`${APP_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await page.locator('input[type="email"]').fill(required('E2E_EMAIL'));
      await page.locator('input[type="password"]').fill(required('E2E_PASSWORD'));
      await page.locator('button[type="submit"]').click();
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 });

      await page.goto(`${APP_URL}/transcription-lab?mode=lashon-kodesh`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await expect(page.getByRole('heading', { name: 'מעבדת תמלול מתקדמת' })).toBeVisible({ timeout: 120_000 });
      await expect(page.getByLabel('הפעל מצב לשון הקודש בריצה B')).toBeChecked();

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        sourceSelectionAttempts = attempt;
        await page.getByRole('button', { name: 'בחר מהתיקיות' }).click();
        const sourceDialog = page.getByTestId('comparison-source-dialog');
        await sourceDialog.getByRole('textbox', { name: 'חיפוש מקור להשוואה' }).fill(SOURCE_QUERY);
        const sourceButton = sourceDialog.locator('button').filter({ hasText: SOURCE_QUERY }).first();
        if (await sourceButton.isVisible({ timeout: 20_000 }).catch(() => false)) {
          await sourceButton.click();
          break;
        }
        await sourceDialog.getByRole('button', { name: 'Close' }).click();
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
        await expect(page.getByRole('heading', { name: 'מעבדת תמלול מתקדמת' })).toBeVisible({ timeout: 120_000 });
      }

      await expect(page.getByText('מקור מקושר מהמערכת', { exact: true })).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText('ההקלטה נטענה; הטקסט הקיים דורש אימות', { exact: true })).toBeVisible();
      await expect(page.locator('#ground-truth')).toHaveValue('');
      await expect(page.locator('#initial-transcript')).not.toHaveValue('');
      experimentId = await page.evaluate(() => localStorage.getItem('asr_pipeline_active_experiment_v1') || '');
      expect(experimentId).toMatch(/^[0-9a-f-]{36}$/i);
      const sourceTranscriptId = (await page.getByText('מקור מקושר מהמערכת', { exact: true }).locator('..').innerText())
        .match(/[0-9a-f]{8}/i)?.[0] || '';

      await page.getByRole('combobox', { name: 'מנוע A - בסיס' }).click();
      await page.getByRole('option', { name: 'Gemini', exact: true }).click();
      await page.getByRole('combobox', { name: 'מנוע B - מועמד' }).click();
      await page.getByRole('option', { name: CANDIDATE_ENGINE_LABEL, exact: true }).click();
      await expect(page.getByRole('combobox', { name: 'מודל A' })).toContainText('Gemini 3.5 Transcribe');
      await expect(page.getByRole('combobox', { name: 'מודל B' })).toContainText(CANDIDATE_MODEL_LABEL);

      await page.getByRole('button', { name: 'הפעל ניסוי מלא' }).click();
      await expect(page.getByText('הניסוי הושלם', { exact: true })).toBeVisible({ timeout: 12 * 60_000 });
      await expect(page.getByText('אין הכרעה מדידה', { exact: true })).toBeVisible();
      await expect(page.getByText('נדרש טקסט אמת כדי להפיק מועמדי תיקון', { exact: true })).toBeVisible();

      const baselineText = await page.locator('section').filter({ has: page.getByRole('heading', { name: /^A · בסיס/ }) }).locator('textarea').inputValue();
      const candidateText = await page.locator('section').filter({ has: page.getByRole('heading', { name: /^B · מועמד/ }) }).locator('textarea').inputValue();
      const localAudit = await page.evaluate((id) => {
        const all = JSON.parse(localStorage.getItem('asr_pipeline_events_v1') || '[]') as Array<any>;
        const current = all.filter((event) => event.experimentId === id);
        return {
          count: current.length,
          stages: [...new Set(current.map((event) => event.stage))],
          events: current,
        };
      }, experimentId);

      expect(localAudit.count).toBeGreaterThanOrEqual(20);
      expect(localAudit.stages).toEqual(expect.arrayContaining([
        'source', 'audio-preprocessing', 'configuration', 'upload', 'transcription',
        'knowledge', 'metrics', 'quality-gate', 'review', 'complete',
      ]));
      expect(localAudit.events.some((event: any) => event.eventType === 'knowledge-trace-valid')).toBe(true);
      expect(localAudit.events.some((event: any) => event.eventType === 'knowledge-trace-invalid')).toBe(false);
      expect(localAudit.events.some((event: any) => event.level === 'error')).toBe(false);
      expect(baselineText.trim().split(/\s+/u).filter(Boolean).length).toBeGreaterThan(10);
      expect(candidateText.trim().split(/\s+/u).filter(Boolean).length).toBeGreaterThan(10);

      const { data: cloudEvents, error: cloudEventError } = await client
        .from('asr_pipeline_events')
        .select('*')
        .eq('experiment_id', experimentId)
        .order('created_at', { ascending: true });
      if (cloudEventError) throw cloudEventError;
      const { data: cloudRuns, error: cloudRunError } = await client
        .from('comparison_runs')
        .select('*')
        .contains('config_snapshot', { experimentId })
        .order('created_at', { ascending: true });
      if (cloudRunError) throw cloudRunError;

      expect(cloudRuns).toHaveLength(2);
      expect(cloudRuns.map((run) => (run.config_snapshot as any).variant).sort()).toEqual(['baseline', 'candidate']);
      expect(cloudRuns.every((run) => run.reference_text === null)).toBe(true);
      expect(cloudRuns.every((run) => Boolean(run.hypothesis_text?.trim()))).toBe(true);
      expect(cloudEvents?.some((event) => event.event_type === 'knowledge-trace-valid')).toBe(true);
      expect(cloudEvents?.some((event) => event.event_type === 'knowledge-trace-invalid')).toBe(false);
      expect(cloudEvents?.some((event) => event.level === 'error')).toBe(false);

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
      await expect(page.getByText(new RegExp(`${localAudit.count} אירועים בריצה זו`))).toBeVisible({ timeout: 120_000 });
      await expect(page.getByText('שרשרת ה-Trace נבדקה וניתנת לשחזור מלא', { exact: true })).toBeVisible();

      const completed = localAudit.events.filter((event: any) => event.eventType === 'transcription-completed');
      const baselineCompleted = completed.find((event: any) => event.details.variant === 'baseline');
      const candidateCompleted = completed.find((event: any) => event.details.variant === 'candidate');
      expect(baselineCompleted?.details.requestedModel).toBe('gemini-3.5-transcribe');
      if (CANDIDATE_ENGINE === 'gemini') {
        expect(candidateCompleted?.details.requestedModel).toBe('gemini-3.5-transcribe');
      } else {
        expect(candidateCompleted?.details.requestedModel).toBe('ivrit-ai/whisper-large-v3-turbo-ct2');
      }
      const baselineTimingCount = Number(baselineCompleted?.details.timingCount || 0);
      const candidateTimingCount = Number(candidateCompleted?.details.timingCount || 0);
      if (CANDIDATE_ENGINE === 'local-server') {
        expect(candidateTimingCount).toBeGreaterThan(10);
      }
      const goldCountAfter = await exactCount(client, 'transcripts', (query) => query.contains('tags', ['asr-gold-source']));
      const lexiconCountAfter = await exactCount(client, 'torah_lexicon_terms');
      expect(goldCountAfter).toBe(goldCountBefore);
      expect(lexiconCountAfter).toBe(lexiconCountBefore);
      expect(sourceUploads).toHaveLength(0);
      expect(pageErrors).toEqual([]);
      expect(failedApiRequests).toEqual([]);

      evidence = {
        experimentId,
        sourceTranscriptId,
        localEventCount: localAudit.count,
        cloudEventCount: cloudEvents?.length || 0,
        cloudRunCount: cloudRuns.length,
        stages: localAudit.stages,
        baselineWords: baselineText.trim().split(/\s+/u).filter(Boolean).length,
        candidateWords: candidateText.trim().split(/\s+/u).filter(Boolean).length,
        baselineModel: baselineCompleted?.details.usedModel || null,
        candidateModel: candidateCompleted?.details.usedModel || null,
        baselineRequestedModel: baselineCompleted?.details.requestedModel || null,
        candidateRequestedModel: candidateCompleted?.details.requestedModel || null,
        baselineProvider: baselineCompleted?.details.provider || null,
        candidateProvider: candidateCompleted?.details.provider || null,
        baselineFallbackReason: baselineCompleted?.details.fallbackReason || null,
        candidateFallbackReason: candidateCompleted?.details.fallbackReason || null,
        baselineTimingCount,
        candidateTimingCount,
        traceValid: true,
        traceValidationErrors: localAudit.events
          .filter((event: any) => event.eventType === 'knowledge-trace-valid')
          .flatMap((event: any) => event.details.validationErrors || []),
        sourceSelectionAttempts,
        expectedNavigationAborts,
        sourceUploadCount: sourceUploads.length,
        goldCountBefore,
        goldCountAfter,
        lexiconCountBefore,
        lexiconCountAfter,
        cleanup: { events: -1, runs: -1 },
      };
    } finally {
      if (experimentId) {
        const cleanup = await cleanupExperiment(client, experimentId);
        if (evidence) evidence.cleanup = cleanup;
      }
      await client.auth.signOut();
      if (evidence) {
        await mkdir('logs/qa', { recursive: true });
        await writeFile(EVIDENCE_FILE, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
      }
    }

    const actionableConsoleErrors = consoleErrors.filter((message) => {
      if (message.includes('Failed to load resource')) return false;
      if (expectedNavigationAborts > 0 && (
        (message.includes('[Cloud]') && message.includes('Error fetching transcripts'))
        || (message.includes('[Cloud]') && message.includes('Error fetching folders'))
        || (message.includes('[Jobs]') && message.includes('Error loading jobs'))
      )) return false;
      return true;
    });
    expect(actionableConsoleErrors).toEqual([]);
  });
});
