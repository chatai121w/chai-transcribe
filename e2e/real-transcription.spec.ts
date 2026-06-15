/**
 * E2E — Real transcription benchmark (against live CUDA server)
 *
 * Tests ALL transcription presets (fast / balanced / accurate) and API paths
 * (/transcribe, /transcribe-stream) plus full UI flow.
 * Uses REAL Hebrew speech audio (generated via edge-tts) and measures both
 * speed AND accuracy against expected transcription.
 *
 * Prerequisites:
 *   - Whisper server running on localhost:3000 with a loaded model
 *   - Vite dev server running on localhost:8080
 *   - Run `python scripts/generate_hebrew_audio.py` to create fixtures
 *
 * Tests skip automatically if the server is not available.
 */

import { test as base, expect, type Page } from '@playwright/test';
import { mockSupabase, injectAuthSession } from './helpers';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Audio generation helpers ────────────────────────────────────────────────

/** Generate a WAV buffer with a sine tone */
function createToneWavBuffer(durationSec = 2, freq = 440, sampleRate = 16000): Buffer {
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buf = Buffer.alloc(fileSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(fileSize - 8, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(16000 * Math.sin(2 * Math.PI * freq * i / sampleRate));
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

/** Generate a longer WAV with mixed tones (mimics speech-like variation) */
function createSpeechLikeWavBuffer(durationSec = 5, sampleRate = 16000): Buffer {
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2;
  const fileSize = 44 + dataSize;
  const buf = Buffer.alloc(fileSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(fileSize - 8, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  // Alternate between fundamental frequencies (speech range 100-300 Hz)
  const freqs = [150, 200, 250, 180, 220];
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const freqIdx = Math.floor(t * 2) % freqs.length; // switch freq every 0.5s
    const freq = freqs[freqIdx];
    const amplitude = (i % (sampleRate / 4) < sampleRate / 8) ? 12000 : 4000; // volume pulses
    const sample = Math.round(amplitude * Math.sin(2 * Math.PI * freq * t));
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), 44 + i * 2);
  }
  return buf;
}

// ─── Server helpers ──────────────────────────────────────────────────────────

const SERVER = 'http://localhost:3000';

// ─── Hebrew audio fixtures ──────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

interface AudioFixture {
  id: string;
  wavPath: string;
  expectedText: string;
  buffer: Buffer;
}

/** Load a Hebrew audio fixture (WAV + expected text) */
function loadFixture(id: string): AudioFixture | null {
  const wavPath = path.join(FIXTURES_DIR, `hebrew_${id}.wav`);
  const txtPath = path.join(FIXTURES_DIR, `hebrew_${id}.expected.txt`);
  if (!fs.existsSync(wavPath) || !fs.existsSync(txtPath)) return null;
  return {
    id,
    wavPath,
    expectedText: fs.readFileSync(txtPath, 'utf-8').trim(),
    buffer: fs.readFileSync(wavPath),
  };
}

/** Normalize Hebrew text for comparison: remove punctuation, collapse whitespace */
function normalizeHebrew(text: string): string {
  return text
    .replace(/[.,;:!?"""''()\-–—…\u05BE]/g, '') // remove punctuation (including Hebrew maqaf)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Compute word-level accuracy between transcribed and expected Hebrew text.
 *  Returns { overlap, precision, recall, f1 } in range [0, 1] */
function computeAccuracy(transcribed: string, expected: string) {
  const transWords = normalizeHebrew(transcribed).split(' ').filter(Boolean);
  const expWords = normalizeHebrew(expected).split(' ').filter(Boolean);

  if (expWords.length === 0) return { overlap: 0, precision: 0, recall: 0, f1: 0, transWords: 0, expWords: 0 };

  // Count word matches (order-independent bag-of-words)
  const expBag = new Map<string, number>();
  for (const w of expWords) expBag.set(w, (expBag.get(w) || 0) + 1);

  let matches = 0;
  for (const w of transWords) {
    const count = expBag.get(w) || 0;
    if (count > 0) {
      matches++;
      expBag.set(w, count - 1);
    }
  }

  const precision = transWords.length > 0 ? matches / transWords.length : 0;
  const recall = matches / expWords.length;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  return { overlap: matches, precision, recall, f1, transWords: transWords.length, expWords: expWords.length };
}

async function isServerUp(page: Page): Promise<boolean> {
  try {
    const r = await page.request.get(`${SERVER}/health`);
    if (!r.ok()) return false;
    const d = await r.json();
    return d.status === 'ok';
  } catch { return false; }
}

/** Parse SSE text body into typed event objects */
function parseSSE(body: string): Array<Record<string, unknown>> {
  return body.split('\n\n')
    .map(chunk => chunk.replace(/^data: /gm, '').trim())
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean) as Array<Record<string, unknown>>;
}

// ─── Benchmark results collector ─────────────────────────────────────────────

interface BenchmarkResult {
  preset: string;
  api: string;
  status: number;
  audioDuration: number;
  processingTime: number;
  rtf: number;        // Real-Time Factor: processing_time / audio_duration
  speedX: string;     // human-readable "Nx faster than real-time"
  model: string;
  text: string;
  fastMode: boolean;
  accuracy: { f1: number; precision: number; recall: number } | null;
}

const benchResults: BenchmarkResult[] = [];

// ─── Test suite ──────────────────────────────────────────────────────────────

const test = base.extend({});

// Run benchmark tests serially — they share the GPU
test.describe.configure({ mode: 'serial' });

test.describe('בנצ\'מארק תמלול — כל הערכות וכל ה-API', () => {

  test.beforeEach(async ({ page }) => {
    await mockSupabase(page);
    await injectAuthSession(page);
  });

  // ═══════════════════════════════════════════════════════════
  //  1. Health & presets validation
  // ═══════════════════════════════════════════════════════════

  test('1. בדיקת חיבור ובריאות שרת', async ({ page }) => {
    const up = await isServerUp(page);
    test.skip(!up, 'שרת CUDA לא זמין');

    const r = await page.request.get(`${SERVER}/health`);
    const health = await r.json();

    expect(health.status).toBe('ok');
    expect(health.device).toBe('cuda');
    expect(health.model_ready).toBe(true);
    expect(health.gpu).toBeTruthy();

    console.log(`\n╔══════════════════════════════════════╗`);
    console.log(`║  🖥️  GPU: ${health.gpu}`);
    console.log(`║  📦 Model: ${health.current_model}`);
    console.log(`║  💾 VRAM: ${health.gpu_memory?.allocated_mb}/${health.gpu_memory?.total_mb} MB`);
    console.log(`╚══════════════════════════════════════╝\n`);
  });

  test('2. אימות ערכות תמלול', async ({ page }) => {
    const up = await isServerUp(page);
    test.skip(!up, 'שרת CUDA לא זמין');

    const r = await page.request.get(`${SERVER}/presets`);
    expect(r.status()).toBe(200);
    const data = await r.json();

    expect(data.default).toBe('balanced');
    expect(data.presets).toHaveProperty('fast');
    expect(data.presets).toHaveProperty('balanced');
    expect(data.presets).toHaveProperty('accurate');

    // Validate preset structure
    for (const [name, p] of Object.entries(data.presets) as [string, Record<string, unknown>][]) {
      expect(p).toHaveProperty('fast_mode');
      expect(p).toHaveProperty('beam_size');
      expect(p).toHaveProperty('batch_size');
      expect(p).toHaveProperty('label');
      console.log(`  ✅ ערכה "${name}": fast_mode=${p.fast_mode}, beam=${p.beam_size}, batch=${p.batch_size}`);
    }
  });

  // ═══════════════════════════════════════════════════════════
  //  2. /transcribe API — all 3 presets
  // ═══════════════════════════════════════════════════════════

  for (const presetName of ['fast', 'balanced', 'accurate'] as const) {
    test(`3.${presetName} — /transcribe ערכת "${presetName}"`, async ({ page }) => {
      test.setTimeout(presetName === 'accurate' ? 180_000 : 90_000);
      const up = await isServerUp(page);
      test.skip(!up, 'שרת CUDA לא זמין');

      // Use real Hebrew audio if available, fallback to synthetic
      const fixture = loadFixture('medium');
      const audioBuffer = fixture?.buffer ?? createSpeechLikeWavBuffer(5);
      const expectedText = fixture?.expectedText ?? null;

      const wallStart = Date.now();

      const response = await page.request.fetch(`${SERVER}/transcribe`, {
        method: 'POST',
        multipart: {
          file: { name: fixture ? 'hebrew_medium.wav' : 'bench.wav', mimeType: 'audio/wav', buffer: audioBuffer },
          language: 'he',
          preset: presetName,
        },
      });

      const wallTime = (Date.now() - wallStart) / 1000;
      expect(response.status()).toBe(200);

      const result = await response.json();
      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('duration');
      expect(result).toHaveProperty('processing_time');
      expect(result.duration).toBeGreaterThan(0);

      // Accuracy measurement
      let accuracy: BenchmarkResult['accuracy'] = null;
      if (expectedText && result.text) {
        const acc = computeAccuracy(result.text, expectedText);
        accuracy = { f1: acc.f1, precision: acc.precision, recall: acc.recall };
      }

      // With real Hebrew audio, we expect non-empty transcription
      if (fixture) {
        expect(result.text.length).toBeGreaterThan(0);
      }

      const rtf = result.processing_time / result.duration;
      const speedX = (1 / rtf).toFixed(1);

      benchResults.push({
        preset: presetName,
        api: '/transcribe',
        status: response.status(),
        audioDuration: result.duration,
        processingTime: result.processing_time,
        rtf,
        speedX: `${speedX}x`,
        model: result.model,
        text: (result.text || '').substring(0, 80),
        fastMode: presetName !== 'accurate',
        accuracy,
      });

      console.log(`\n  📊 /transcribe [${presetName}]:`);
      console.log(`     ⏱️  עיבוד: ${result.processing_time.toFixed(2)}s (wall: ${wallTime.toFixed(2)}s)`);
      console.log(`     🎵 אודיו: ${result.duration.toFixed(1)}s`);
      console.log(`     🚀 מהירות: ${speedX}x מזמן אמת (RTF=${rtf.toFixed(3)})`);
      if (accuracy) {
        console.log(`     🎯 דיוק: F1=${(accuracy.f1 * 100).toFixed(1)}% | Precision=${(accuracy.precision * 100).toFixed(1)}% | Recall=${(accuracy.recall * 100).toFixed(1)}%`);
      }
      console.log(`     📝 טקסט: "${(result.text || '(ריק)').substring(0, 80)}"`);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  3. /transcribe-stream SSE — all 3 presets
  // ═══════════════════════════════════════════════════════════

  for (const presetName of ['fast', 'balanced', 'accurate'] as const) {
    test(`4.${presetName} — /transcribe-stream ערכת "${presetName}"`, async ({ page }) => {
      test.setTimeout(presetName === 'accurate' ? 180_000 : 90_000);
      const up = await isServerUp(page);
      test.skip(!up, 'שרת CUDA לא זמין');

      // Use real Hebrew audio if available, fallback to synthetic
      const fixture = loadFixture('medium');
      const audioBuffer = fixture?.buffer ?? createSpeechLikeWavBuffer(5);
      const expectedText = fixture?.expectedText ?? null;

      const wallStart = Date.now();

      const response = await page.request.fetch(`${SERVER}/transcribe-stream`, {
        method: 'POST',
        multipart: {
          file: { name: fixture ? 'hebrew_medium.wav' : 'bench.wav', mimeType: 'audio/wav', buffer: audioBuffer },
          language: 'he',
          preset: presetName,
        },
      });

      const wallTime = (Date.now() - wallStart) / 1000;
      expect(response.status()).toBe(200);

      const body = await response.text();
      const events = parseSSE(body);
      const types = events.map(e => e.type);

      // Must have the core event flow
      expect(types).toContain('loading');
      expect(types).toContain('info');
      expect(types).toContain('done');

      const doneEvent = events.find(e => e.type === 'done') as Record<string, unknown>;
      expect(doneEvent).toBeTruthy();

      const dur = doneEvent.duration as number;
      const pt = doneEvent.processing_time as number;
      const txt = (doneEvent.text as string) || '';
      const model = (doneEvent.model as string) || '';
      const fm = doneEvent.fast_mode as boolean;
      const rtf = pt / dur;
      const speedX = (1 / rtf).toFixed(1);

      // Accuracy measurement
      let accuracy: BenchmarkResult['accuracy'] = null;
      if (expectedText && txt) {
        const acc = computeAccuracy(txt, expectedText);
        accuracy = { f1: acc.f1, precision: acc.precision, recall: acc.recall };
      }

      // With real Hebrew audio, we expect non-empty transcription
      if (fixture) {
        expect(txt.length).toBeGreaterThan(0);
      }

      benchResults.push({
        preset: presetName,
        api: '/transcribe-stream',
        status: response.status(),
        audioDuration: dur,
        processingTime: pt,
        rtf,
        speedX: `${speedX}x`,
        model,
        text: txt.substring(0, 80),
        fastMode: fm,
        accuracy,
      });

      // Count how many segment events we got (streaming increments)
      const segmentCount = events.filter(e => e.type === 'segment').length;

      console.log(`\n  📊 /transcribe-stream [${presetName}]:`);
      console.log(`     ⏱️  עיבוד: ${pt.toFixed(2)}s (wall: ${wallTime.toFixed(2)}s)`);
      console.log(`     🎵 אודיו: ${dur.toFixed(1)}s`);
      console.log(`     🚀 מהירות: ${speedX}x מזמן אמת (RTF=${rtf.toFixed(3)})`);
      if (accuracy) {
        console.log(`     🎯 דיוק: F1=${(accuracy.f1 * 100).toFixed(1)}% | Precision=${(accuracy.precision * 100).toFixed(1)}% | Recall=${(accuracy.recall * 100).toFixed(1)}%`);
      }
      console.log(`     📡 SSE אירועים: ${events.length} (${segmentCount} segments)`);
      console.log(`     ⚡ fast_mode: ${fm}`);
      console.log(`     📝 טקסט: "${txt.substring(0, 80) || '(ריק)'}"`);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  4. Manual params (no preset) — verify individual overrides
  // ═══════════════════════════════════════════════════════════

  test('5. תמלול עם פרמטרים ידניים (ללא ערכה)', async ({ page }) => {
    test.setTimeout(60_000);
    const up = await isServerUp(page);
    test.skip(!up, 'שרת CUDA לא זמין');

    const audioBuffer = createToneWavBuffer(3);
    const wallStart = Date.now();

    const response = await page.request.fetch(`${SERVER}/transcribe-stream`, {
      method: 'POST',
      multipart: {
        file: { name: 'manual.wav', mimeType: 'audio/wav', buffer: audioBuffer },
        language: 'he',
        fast_mode: '1',
        beam_size: '1',
        batch_size: '24',
        no_condition_on_previous: '1',
        vad_aggressive: '1',
      },
    });

    const wallTime = (Date.now() - wallStart) / 1000;
    expect(response.status()).toBe(200);

    const events = parseSSE(await response.text());
    const doneEvent = events.find(e => e.type === 'done') as Record<string, unknown>;
    expect(doneEvent).toBeTruthy();
    expect(doneEvent.fast_mode).toBe(true);

    const pt = doneEvent.processing_time as number;
    const dur = doneEvent.duration as number;

    console.log(`\n  📊 Manual params (fast_mode=1, beam=1, batch=24):`);
    console.log(`     ⏱️  עיבוד: ${pt.toFixed(2)}s (wall: ${wallTime.toFixed(2)}s)`);
    console.log(`     🚀 מהירות: ${(1 / (pt / dur)).toFixed(1)}x מזמן אמת`);
  });

  // ═══════════════════════════════════════════════════════════
  //  5. Full UI E2E — select CUDA, upload, get result
  // ═══════════════════════════════════════════════════════════

  test('6. תמלול E2E מלא דרך UI', async ({ page }) => {
    test.setTimeout(90_000);
    const up = await isServerUp(page);
    test.skip(!up, 'שרת CUDA לא זמין');

    // Set fast preset in localStorage before navigation
    await page.addInitScript(() => {
      localStorage.setItem('cuda_preset', 'fast');
      localStorage.setItem('cuda_fast_mode', '1');
      localStorage.setItem('cuda_beam_size', '1');
      localStorage.setItem('cuda_no_condition_prev', '1');
      localStorage.setItem('cuda_vad_aggressive', '1');
      localStorage.setItem('cuda_compute_type', 'int8_float16');
      localStorage.setItem('transcription_engine', 'local-server');
    });

    await page.goto('/transcribe');

    // Select CUDA engine
    const cudaOption = page.getByText('CUDA');
    await expect(cudaOption.first()).toBeVisible({ timeout: 3000 });
    await cudaOption.first().click();

    // Wait for server connected
    await expect(page.getByText(/מחובר|connected|NVIDIA/i)).toBeVisible({ timeout: 10000 });

    // Upload file
    const audioBuffer = createSpeechLikeWavBuffer(3);
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'e2e-benchmark.wav',
      mimeType: 'audio/wav',
      buffer: audioBuffer,
    });

    await page.waitForTimeout(1000);

    // Click start button if visible
    const startButton = page.getByRole('button', { name: /תמלל|התחל|start/i });
    if (await startButton.count() > 0 && await startButton.first().isEnabled()) {
      await startButton.first().click();
    }

    // Wait for one of the success outcomes
    const outcome = await Promise.race([
      page.waitForURL(/text-editor/, { timeout: 60_000 }).then(() => 'navigated' as const),
      page.getByText('📝 תמלול חי').waitFor({ timeout: 60_000 }).then(() => 'live-text' as const),
      page.getByText(/processing_time|עיבוד|מילים/).first().waitFor({ timeout: 60_000 }).then(() => 'stats' as const),
    ]).catch(() => 'timeout' as const);

    expect(['navigated', 'live-text', 'stats']).toContain(outcome);
    console.log(`\n  🎯 UI E2E outcome: ${outcome}`);
  });

  // ═══════════════════════════════════════════════════════════
  //  6. Summary — print comparison table
  // ═══════════════════════════════════════════════════════════

  test('7. סיכום בנצ\'מארק — טבלת השוואה', async ({ page }) => {
    const up = await isServerUp(page);
    test.skip(!up, 'שרת CUDA לא זמין');

    // This test just prints the collected results from previous tests
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    📊 סיכום בנצ\'מארק תמלול — כל הערכות (עברית אמיתית)               ║');
    console.log('╠══════════════╦═══════════════════╦══════════╦══════════╦═══════╦═══════════╦══════════╣');
    console.log('║ ערכה         ║ API               ║ אודיו(s) ║ עיבוד(s) ║ מהיר  ║ fast_mode ║ דיוק F1 ║');
    console.log('╠══════════════╬═══════════════════╬══════════╬══════════╬═══════╬═══════════╬══════════╣');

    if (benchResults.length === 0) {
      console.log('║  (אין תוצאות — הרץ את כל הבדיקות ביחד)                                                ║');
    }
    for (const r of benchResults) {
      const preset = r.preset.padEnd(12);
      const api = r.api.padEnd(17);
      const audio = r.audioDuration.toFixed(1).padStart(6);
      const proc = r.processingTime.toFixed(2).padStart(6);
      const speed = r.speedX.padStart(5);
      const fm = r.fastMode ? '  ✅   ' : '  ❌   ';
      const acc = r.accuracy ? `${(r.accuracy.f1 * 100).toFixed(0)}%`.padStart(5) : '  N/A';
      console.log(`║ ${preset} ║ ${api} ║ ${audio}   ║ ${proc}   ║ ${speed} ║${fm}    ║  ${acc}   ║`);
    }

    console.log('╚══════════════╩═══════════════════╩══════════╩══════════╩═══════╩═══════════╩══════════╝');

    // Print best accuracy result
    const withAccuracy = benchResults.filter(r => r.accuracy);
    if (withAccuracy.length > 0) {
      const best = withAccuracy.reduce((a, b) => (a.accuracy!.f1 > b.accuracy!.f1 ? a : b));
      const fastest = withAccuracy.reduce((a, b) => (a.processingTime < b.processingTime ? a : b));
      console.log(`\n  🏆 דיוק הכי גבוה: ${best.preset}/${best.api} — F1=${(best.accuracy!.f1 * 100).toFixed(1)}%`);
      console.log(`  ⚡ הכי מהיר: ${fastest.preset}/${fastest.api} — ${fastest.processingTime.toFixed(2)}s (${fastest.speedX})`);
    }
    console.log('');

    // Basic assertion — we should have results if previous tests ran
    // (This test is informational, it always passes)
    expect(true).toBe(true);
  });
});
