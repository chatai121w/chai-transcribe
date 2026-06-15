/**
 * Debug tests for CUDA Live Transcription
 * Tests the /transcribe-live endpoint and simulates the chunked flow
 * that LiveTranscriber.tsx uses.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SERVER = 'http://localhost:3000';
const WAV_PATH = path.resolve('e2e/fixtures/hebrew_short.wav');

// Helper: send a blob to /transcribe-live
async function sendLiveChunk(
  request: import('@playwright/test').APIRequestContext,
  fileBuffer: Buffer,
  filename = 'chunk.webm',
): Promise<{ status: number; body: any; latencyMs: number }> {
  const start = performance.now();
  const resp = await request.post(`${SERVER}/transcribe-live`, {
    multipart: {
      file: { name: filename, mimeType: 'audio/webm', buffer: fileBuffer },
      language: 'he',
    },
    timeout: 20000,
  });
  const latencyMs = Math.round(performance.now() - start);
  let body: any = null;
  try {
    body = await resp.json();
  } catch {
    body = await resp.text();
  }
  return { status: resp.status(), body, latencyMs };
}

test.describe('CUDA Live Transcription - Debug Tests', () => {
  test.beforeAll(async ({ request }) => {
    // Verify server is up
    const health = await request.get(`${SERVER}/health`, { timeout: 5000 });
    expect(health.ok()).toBeTruthy();
    const data = await health.json();
    console.log(`Server: ${data.device} | Model: ${data.current_model} | GPU: ${data.gpu}`);
    expect(data.model_ready).toBe(true);
  });

  test('בדיקה 1: שליחת קובץ שלם ל-/transcribe-live', async ({ request }) => {
    console.log('\n===== TEST 1: Full file to /transcribe-live =====');
    const wavBuf = fs.readFileSync(WAV_PATH);
    console.log(`Sending ${wavBuf.length} bytes as chunk.webm...`);

    const { status, body, latencyMs } = await sendLiveChunk(request, wavBuf, 'chunk.wav');
    console.log(`Status: ${status} | Latency: ${latencyMs}ms`);
    console.log(`Response:`, JSON.stringify(body, null, 2));

    expect(status).toBe(200);
    expect(body.text).toBeTruthy();
    expect(body.text.length).toBeGreaterThan(5);
    console.log(`✓ Transcription: "${body.text}"`);
  });

  test('בדיקה 2: שלושה chunks ברצף (סימולציית live)', async ({ request }) => {
    console.log('\n===== TEST 2: Sequential chunks (simulating live flow) =====');
    const wavBuf = fs.readFileSync(WAV_PATH);
    
    // Split into 3 chunks (simulating 2s chunks from MediaRecorder)
    const chunkSize = Math.ceil(wavBuf.length / 3);
    const chunks = [
      wavBuf.subarray(0, chunkSize),
      wavBuf.subarray(chunkSize, chunkSize * 2),
      wavBuf.subarray(chunkSize * 2),
    ];

    const results: string[] = [];
    let totalLatency = 0;

    for (let i = 0; i < chunks.length; i++) {
      console.log(`\nChunk ${i + 1}/${chunks.length}: ${chunks[i].length} bytes`);
      const { status, body, latencyMs } = await sendLiveChunk(request, chunks[i]);
      console.log(`  Status: ${status} | Latency: ${latencyMs}ms`);

      if (status === 200) {
        const text = body.text?.trim() || '';
        console.log(`  Text: "${text}" (${text.length} chars)`);
        if (text) results.push(text);
        totalLatency += latencyMs;
      } else if (status === 429) {
        console.log(`  GPU busy — waiting 2s and retrying...`);
        await new Promise(r => setTimeout(r, 2000));
        const retry = await sendLiveChunk(request, chunks[i]);
        console.log(`  Retry status: ${retry.status} | Text: "${retry.body?.text}"`);
        if (retry.body?.text) results.push(retry.body.text);
        totalLatency += retry.latencyMs;
      } else {
        console.log(`  ERROR body:`, body);
      }
    }

    console.log(`\n--- Summary ---`);
    console.log(`Chunks sent: ${chunks.length}`);
    console.log(`Results: ${results.length}`);
    console.log(`Total latency: ${totalLatency}ms`);
    console.log(`Combined text: "${results.join(' ')}"`);
    
    // At least one chunk should return text
    expect(results.length).toBeGreaterThan(0);
  });

  test('בדיקה 3: שליחות מקבילות (backpressure test)', async ({ request }) => {
    console.log('\n===== TEST 3: Concurrent sends (backpressure test) =====');
    const wavBuf = fs.readFileSync(WAV_PATH);

    // Send 3 requests simultaneously — simulates what happens when chunks pile up
    console.log('Sending 3 concurrent requests...');
    const start = performance.now();
    const [r1, r2, r3] = await Promise.all([
      sendLiveChunk(request, wavBuf, 'chunk1.wav'),
      sendLiveChunk(request, wavBuf, 'chunk2.wav'),
      sendLiveChunk(request, wavBuf, 'chunk3.wav'),
    ]);
    const totalMs = Math.round(performance.now() - start);

    console.log(`Request 1: status=${r1.status} latency=${r1.latencyMs}ms text="${r1.body?.text?.substring(0, 60) || r1.body}"`);
    console.log(`Request 2: status=${r2.status} latency=${r2.latencyMs}ms text="${r2.body?.text?.substring(0, 60) || r2.body}"`);
    console.log(`Request 3: status=${r3.status} latency=${r3.latencyMs}ms text="${r3.body?.text?.substring(0, 60) || r3.body}"`);
    console.log(`Total wall time: ${totalMs}ms`);

    // Count successes and 429s
    const statuses = [r1.status, r2.status, r3.status];
    const successes = statuses.filter(s => s === 200).length;
    const busy = statuses.filter(s => s === 429).length;
    const errors = statuses.filter(s => s >= 500).length;
    console.log(`Results: ${successes} OK, ${busy} GPU-busy (429), ${errors} errors`);

    // At least one should succeed
    expect(successes).toBeGreaterThanOrEqual(1);
    // We expect some 429s — that's correct behavior
    if (busy > 0) {
      console.log('✓ Server correctly returns 429 when GPU is busy');
    }
  });
});
