import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function sanitizeFileName(name: string): string {
  const ext = name.split('.').pop() || 'webm';
  return `audio_${Date.now()}.${ext}`;
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 2000): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if ((err as any)?.noRetry) throw lastError;
      if (i < retries) {
        console.log(`Retry ${i + 1}/${retries}: ${lastError.message}`);
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}

// ─────────────────────────────────────────────────────────────────────────────
// API key pool with per-key cool-down (mid-job rotation on 429 / auth errors)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_COOLDOWN_MS = 60_000; // fallback if no Retry-After header
const cooldownUntil = new Map<string, number>(); // key → epoch ms

function buildPool(single: string | undefined | null, pool: unknown): string[] {
  const out: string[] = [];
  if (single && typeof single === 'string' && single.trim()) out.push(single.trim());
  if (Array.isArray(pool)) {
    for (const k of pool) {
      if (typeof k === 'string' && k.trim() && !out.includes(k.trim())) out.push(k.trim());
    }
  }
  return out;
}

function keyTag(k: string): string {
  if (!k) return '∅';
  if (k.length <= 8) return k;
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function parseRetryAfterMs(headerValue: string | null, body: string): number {
  if (headerValue) {
    const secs = Number(headerValue);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 30 * 60_000);
  }
  // Groq returns: "Please try again in 2m23.456s" or "try again in 45s"
  const m = body.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)s/i);
  if (m) {
    const mins = Number(m[1] || 0);
    const secs = Number(m[2] || 0);
    return (mins * 60 + secs) * 1000;
  }
  return DEFAULT_COOLDOWN_MS;
}

function isRotatableStatus(status: number): boolean {
  return status === 429 || status === 401 || status === 403;
}

interface PoolRunContext {
  chunkLabel: string; // e.g. "chunk 3/12" — for logs
  provider: string;   // "groq" | "openai" | ...
}

/**
 * Run an API call with rotation across a key pool.
 * - On 429/401/403: marks the key as cooling-down and tries the next one.
 * - On the last key still failing with cool-downable error: waits for the
 *   shortest remaining cool-down then retries one more pass.
 * - On non-rotatable failure: rethrows immediately (real error, not quota).
 */
async function runWithPool<T>(
  pool: string[],
  ctx: PoolRunContext,
  fn: (apiKey: string) => Promise<T>
): Promise<{ result: T; usedKey: string }> {
  if (pool.length === 0) throw new Error('No API keys available in pool');

  const now = () => Date.now();
  let lastErr: Error | undefined;

  // Two passes: first try every non-cooling key; if all are cooling, wait for the earliest.
  for (let pass = 0; pass < 2; pass++) {
    let triedAny = false;
    let earliestCooldown = Infinity;

    for (const apiKey of pool) {
      const until = cooldownUntil.get(apiKey) || 0;
      if (until > now()) {
        earliestCooldown = Math.min(earliestCooldown, until);
        console.log(`[${ctx.provider}] [${ctx.chunkLabel}] key ${keyTag(apiKey)} cooling for ${Math.ceil((until - now()) / 1000)}s — skipping`);
        continue;
      }
      triedAny = true;
      console.log(`[${ctx.provider}] [${ctx.chunkLabel}] trying key ${keyTag(apiKey)}`);
      try {
        const result = await fn(apiKey);
        console.log(`[${ctx.provider}] [${ctx.chunkLabel}] ✓ success with key ${keyTag(apiKey)}`);
        return { result, usedKey: apiKey };
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const status = (err as any)?.status as number | undefined;
        const retryAfterMs = (err as any)?.retryAfterMs as number | undefined;
        if (status && isRotatableStatus(status)) {
          const cool = retryAfterMs || DEFAULT_COOLDOWN_MS;
          cooldownUntil.set(apiKey, now() + cool);
          console.warn(`[${ctx.provider}] [${ctx.chunkLabel}] key ${keyTag(apiKey)} → ${status}; cool-down ${Math.ceil(cool / 1000)}s. Trying next key.`);
          continue;
        }
        // Non-rotatable error: real failure, don't waste other keys.
        console.error(`[${ctx.provider}] [${ctx.chunkLabel}] key ${keyTag(apiKey)} hard-failed:`, lastErr.message);
        throw lastErr;
      }
    }

    if (triedAny) break; // Already tried every available key once
    // Every key is cooling — wait for the earliest and try again
    const waitMs = Math.max(0, earliestCooldown - now()) + 500;
    if (!Number.isFinite(waitMs) || waitMs <= 0) break;
    console.log(`[${ctx.provider}] [${ctx.chunkLabel}] all ${pool.length} keys cooling; waiting ${Math.ceil(waitMs / 1000)}s for earliest reset`);
    await new Promise(r => setTimeout(r, Math.min(waitMs, 90_000)));
  }

  throw lastErr || new Error(`All ${pool.length} keys exhausted for ${ctx.provider}`);
}

const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB

async function transcribeBlob(
  blob: Blob,
  engine: string,
  language: string,
  fileName: string,
  userApiKeys?: Record<string, any>,
  chunkLabel: string = 'single'
): Promise<{ text: string; usedKey: string | null; provider: string }> {
  const safeFileName = sanitizeFileName(fileName);

  if (engine === 'local' || engine === 'local-server') {
    throw new Error(`Engine "${engine}" runs locally and cannot be processed in the cloud. Use an online engine (groq, openai, google, assemblyai, deepgram).`);
  }

  if (engine === 'groq') {
    const pool = buildPool(
      userApiKeys?.groq_key || Deno.env.get('GROQ_API_KEY'),
      userApiKeys?.groq_keys_pool
    );
    if (pool.length === 0) throw new Error('GROQ_API_KEY not configured. Please add your Groq API key in Settings.');

    const { result, usedKey } = await runWithPool(pool, { provider: 'groq', chunkLabel }, async (apiKey) => {
      const fd = new FormData();
      fd.append('file', blob, safeFileName);
      fd.append('model', 'whisper-large-v3');
      if (language && language !== 'auto') {
        fd.append('language', language);
      }
      fd.append('response_format', 'text');

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`Groq API error: ${response.status} - ${errorText.slice(0, 200)}`);
        (err as any).status = response.status;
        if (response.status === 429) {
          (err as any).retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), errorText);
        }
        throw err;
      }
      return await response.text();
    });
    return { text: result, usedKey, provider: 'groq' };
  } else if (engine === 'openai') {
    const pool = buildPool(
      userApiKeys?.openai_key || Deno.env.get('OPENAI_API_KEY'),
      userApiKeys?.openai_keys_pool
    );
    if (pool.length === 0) throw new Error('OPENAI_API_KEY not configured. Please add your OpenAI API key in Settings.');

    const { result, usedKey } = await runWithPool(pool, { provider: 'openai', chunkLabel }, async (apiKey) => {
      const fd = new FormData();
      fd.append('file', blob, safeFileName);
      fd.append('model', 'whisper-1');
      fd.append('language', language || 'he');
      fd.append('response_format', 'text');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`OpenAI API error: ${response.status} - ${errorText.slice(0, 200)}`);
        (err as any).status = response.status;
        if (response.status === 429) {
          (err as any).retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), errorText);
        }
        throw err;
      }
      return await response.text();
    });
    return { text: result, usedKey, provider: 'openai' };
  } else if (engine === 'deepgram') {
    const pool = buildPool(
      userApiKeys?.deepgram_key || Deno.env.get('DEEPGRAM_API_KEY'),
      userApiKeys?.deepgram_keys_pool
    );
    if (pool.length === 0) throw new Error('DEEPGRAM_API_KEY not configured. Please add your Deepgram API key in Settings.');

    const { result, usedKey } = await runWithPool(pool, { provider: 'deepgram', chunkLabel }, async (apiKey) => {
      const arrayBuffer = await blob.arrayBuffer();
      const langMap: Record<string, string> = { 'he': 'he', 'yi': 'he', 'en': 'en', 'auto': 'multi' };
      const dgLang = langMap[language] || 'multi';

      const response = await fetch(
        `https://api.deepgram.com/v1/listen?language=${dgLang}&model=nova-2&smart_format=true`,
        {
          method: 'POST',
          headers: { 'Authorization': `Token ${apiKey}`, 'Content-Type': blob.type || 'audio/webm' },
          body: arrayBuffer,
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`Deepgram API error: ${response.status} - ${errorText.slice(0, 200)}`);
        (err as any).status = response.status;
        if (response.status === 429) {
          (err as any).retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), errorText);
        }
        throw err;
      }
      const jsonResult = await response.json();
      const text = jsonResult.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      if (!text) throw new Error('No transcription received from Deepgram');
      return text;
    });
    return { text: result, usedKey, provider: 'deepgram' };
  } else if (engine === 'assemblyai') {
    const pool = buildPool(
      userApiKeys?.assemblyai_key || Deno.env.get('ASSEMBLYAI_API_KEY'),
      userApiKeys?.assemblyai_keys_pool
    );
    if (pool.length === 0) throw new Error('ASSEMBLYAI_API_KEY not configured. Please add your AssemblyAI API key in Settings.');

    const { result, usedKey } = await runWithPool(pool, { provider: 'assemblyai', chunkLabel }, async (apiKey) => {
      const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
        method: 'POST', headers: { 'authorization': apiKey }, body: blob,
      });
      if (!uploadRes.ok) {
        const errorText = await uploadRes.text();
        const err = new Error(`AssemblyAI upload failed: ${uploadRes.status} - ${errorText.slice(0, 200)}`);
        (err as any).status = uploadRes.status;
        if (uploadRes.status === 429) (err as any).retryAfterMs = parseRetryAfterMs(uploadRes.headers.get('retry-after'), errorText);
        throw err;
      }
      const { upload_url } = await uploadRes.json();

      const txRes = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: { 'authorization': apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ audio_url: upload_url, language_code: language === 'auto' ? null : language }),
      });
      if (!txRes.ok) {
        const errorText = await txRes.text();
        const err = new Error(`AssemblyAI transcription request failed: ${txRes.status} - ${errorText.slice(0, 200)}`);
        (err as any).status = txRes.status;
        if (txRes.status === 429) (err as any).retryAfterMs = parseRetryAfterMs(txRes.headers.get('retry-after'), errorText);
        throw err;
      }
      const { id } = await txRes.json();

      while (true) {
        const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
          headers: { 'authorization': apiKey },
        });
        const transcript = await pollRes.json();
        if (transcript.status === 'completed') return (transcript.text || '') as string;
        if (transcript.status === 'error') throw new Error(`AssemblyAI failed: ${transcript.error}`);
        await new Promise(r => setTimeout(r, 1500));
      }
    });
    return { text: result, usedKey, provider: 'assemblyai' };
  } else if (engine === 'google') {
    const pool = buildPool(
      userApiKeys?.google_key || Deno.env.get('GOOGLE_API_KEY'),
      userApiKeys?.google_keys_pool
    );
    if (pool.length === 0) throw new Error('GOOGLE_API_KEY not configured. Please add your Google API key in Settings.');

    const { result, usedKey } = await runWithPool(pool, { provider: 'google', chunkLabel }, async (apiKey) => {
      const arrayBuffer = await blob.arrayBuffer();
      const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      const ext = (safeFileName).split('.').pop()?.toLowerCase() || 'webm';
      const encodingMap: Record<string, { encoding: string; sampleRateHertz: number }> = {
        webm: { encoding: 'WEBM_OPUS', sampleRateHertz: 48000 },
        ogg: { encoding: 'OGG_OPUS', sampleRateHertz: 48000 },
        mp3: { encoding: 'MP3', sampleRateHertz: 16000 },
        wav: { encoding: 'LINEAR16', sampleRateHertz: 16000 },
        flac: { encoding: 'FLAC', sampleRateHertz: 16000 },
      };
      const audioConfig = encodingMap[ext] || { encoding: 'WEBM_OPUS', sampleRateHertz: 48000 };

      const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { ...audioConfig, languageCode: 'he-IL', enableAutomaticPunctuation: true },
          audio: { content: base64Audio },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`Google API error: ${response.status} - ${errorText.slice(0, 200)}`);
        (err as any).status = response.status;
        if (response.status === 429) (err as any).retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), errorText);
        throw err;
      }
      const jsonResult = await response.json();
      const text = jsonResult.results?.map((r: any) => r.alternatives?.[0]?.transcript || '').join(' ') || '';
      if (!text) throw new Error('No transcription received from Google');
      return text;
    });
    return { text: result, usedKey, provider: 'google' };
  }

  throw new Error(`Unsupported engine: ${engine}`);
}

function keyFp(key: string | null): string {
  if (!key) return '';
  const k = key.trim();
  if (k.length <= 10) return k;
  return `${k.slice(0, 4)}...${k.slice(-4)}`;
}

function wordCount(text: string): number {
  return (text || '').split(/\s+/).filter(Boolean).length;
}

// Rough estimate: ~16kB/s for typical compressed audio (~128kbps).
function estimateSecondsFromBytes(bytes: number): number {
  return bytes / 16000;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { jobId } = await req.json();
    if (!jobId) throw new Error('jobId is required');

    console.log('Processing transcription job:', jobId);

    const { data: job, error: jobError } = await adminClient
      .from('transcription_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) throw new Error(`Job not found: ${jobId}`);
    if (job.status === 'completed') {
      return new Response(JSON.stringify({ status: 'already_completed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch user's API keys from cloud
    let userApiKeys: Record<string, string> = {};
    try {
      const { data: keysData } = await adminClient
        .from('user_api_keys')
        .select('*')
        .eq('user_identifier', job.user_id)
        .maybeSingle();
      if (keysData) {
        userApiKeys = keysData as Record<string, string>;
      }
    } catch (e) {
      console.log('Could not fetch user API keys, falling back to env:', e);
    }

    await adminClient.from('transcription_jobs')
      .update({ status: 'processing', progress: 30, updated_at: new Date().toISOString() })
      .eq('id', jobId);

    // Download file
    const { data: fileData, error: dlError } = await adminClient.storage
      .from('audio-files')
      .download(job.file_path);

    if (dlError || !fileData) throw new Error(`Failed to download file: ${dlError?.message}`);

    await adminClient.from('transcription_jobs')
      .update({ progress: 50, updated_at: new Date().toISOString() })
      .eq('id', jobId);

    const engine = job.engine || 'groq';
    const totalChunks = job.total_chunks || 1;
    const startChunk = job.completed_chunks || 0;
    let partialResult = job.partial_result || '';

    // Per-key usage accumulator for this job (key_fp -> totals)
    const usageByKey: Record<string, { provider: string; seconds: number; words: number }> = {};
    const recordUsage = (provider: string, key: string | null, seconds: number, words: number) => {
      const fp = keyFp(key);
      if (!fp) return;
      const k = `${provider}:${fp}`;
      if (!usageByKey[k]) usageByKey[k] = { provider, seconds: 0, words: 0 };
      usageByKey[k].seconds += Math.max(0, seconds);
      usageByKey[k].words += Math.max(0, words);
    };

    if (totalChunks <= 1 || fileData.size <= CHUNK_SIZE) {
      // Single chunk - simple path
      const r = await transcribeBlob(fileData, engine, job.language || 'he', job.file_name || 'audio.webm', userApiKeys, 'single');
      partialResult = r.text;
      recordUsage(r.provider, r.usedKey, estimateSecondsFromBytes(fileData.size), wordCount(r.text));
    } else {
      // Multi-chunk processing with resume
      const actualChunks = Math.ceil(fileData.size / CHUNK_SIZE);
      
      for (let i = startChunk; i < actualChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileData.size);
        const chunkBlob = fileData.slice(start, end, fileData.type || 'application/octet-stream');

        const chunkLabel = `chunk ${i + 1}/${actualChunks}`;
        console.log(`[${engine}] processing ${chunkLabel} (${chunkBlob.size} bytes)`);

        const r = await transcribeBlob(
          chunkBlob, engine, job.language || 'he', job.file_name || 'audio.webm', userApiKeys, chunkLabel
        );

        partialResult += (partialResult ? ' ' : '') + r.text;
        recordUsage(r.provider, r.usedKey, estimateSecondsFromBytes(chunkBlob.size), wordCount(r.text));

        // Save partial progress
        const chunkProgress = 50 + Math.round(((i + 1) / actualChunks) * 40);
        await adminClient.from('transcription_jobs')
          .update({
            partial_result: partialResult,
            completed_chunks: i + 1,
            progress: chunkProgress,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      }
    }

    // Persist per-key usage events (one row per key used in this job)
    try {
      const rows = Object.entries(usageByKey).map(([k, v]) => ({
        user_id: job.user_id,
        provider: v.provider,
        key_fp: k.split(':')[1],
        seconds: Number(v.seconds.toFixed(2)),
        words: v.words,
      }));
      if (rows.length > 0) {
        const { error: usageErr } = await adminClient.from('api_key_usage_events').insert(rows);
        if (usageErr) console.warn('Failed to insert api_key_usage_events:', usageErr.message);
        else console.log(`Recorded ${rows.length} usage event(s) for job ${jobId}`);
      }
    } catch (e) {
      console.warn('Usage tracking error:', e);
    }

    // Complete
    await adminClient.from('transcription_jobs')
      .update({
        status: 'completed',
        result_text: partialResult,
        progress: 100,
        completed_chunks: totalChunks,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    // Cleanup
    await adminClient.storage.from('audio-files').remove([job.file_path]);

    console.log('Job completed:', jobId);

    return new Response(JSON.stringify({ status: 'completed', text: partialResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error processing job:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error';

    try {
      const { jobId } = await req.clone().json().catch(() => ({ jobId: null }));
      if (jobId) {
        await adminClient.from('transcription_jobs')
          .update({ status: 'failed', error_message: msg, updated_at: new Date().toISOString() })
          .eq('id', jobId);
      }
    } catch {}

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
