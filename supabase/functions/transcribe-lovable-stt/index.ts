import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

/**
 * transcribe-lovable-stt
 *
 * Wraps Lovable AI's /v1/audio/transcriptions endpoint.
 * Accepts multipart/form-data with a `file` field (audio) and forwards
 * to the gateway with the requested model. Buffered (non-streaming) so
 * the client receives one JSON with the final transcript + usage.
 *
 * Used by the ASR training page where we need the final text for diff/WER.
 */

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/audio/transcriptions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini-transcribe';
const ALLOWED_MODELS = new Set([
  'openai/gpt-4o-mini-transcribe',
  'openai/gpt-4o-transcribe',
]);

function extFromMime(mime: string): string {
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'audio/webm': return 'webm';
    case 'audio/mp4':
    case 'audio/x-m4a':
    case 'audio/m4a': return 'mp4';
    case 'audio/mpeg':
    case 'audio/mp3': return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav': return 'wav';
    case 'audio/ogg': return 'ogg';
    case 'audio/flac': return 'flac';
    default: return 'webm';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('multipart/form-data')) {
      return new Response(JSON.stringify({ error: 'Expected multipart/form-data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const form = await req.formData();
    const file = form.get('file');
    const model = (form.get('model') as string) || DEFAULT_MODEL;
    const language = (form.get('language') as string) || '';

    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: 'Missing audio file' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (file.size < 1024) {
      return new Response(JSON.stringify({ error: 'Audio file too small (empty recording?)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (file.size > 25 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'Audio file exceeds 25 MiB gateway limit' }), {
        status: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!ALLOWED_MODELS.has(model)) {
      return new Response(JSON.stringify({ error: `Unsupported model: ${model}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Re-pack with correct filename extension so OpenAI's MIME inference works.
    const ext = extFromMime(file.type);
    const filename = file.name && file.name.includes('.') ? file.name : `audio.${ext}`;

    const upstream = new FormData();
    upstream.append('model', model);
    upstream.append('file', file, filename);
    if (language && /^[a-z]{2}$/.test(language)) upstream.append('language', language);

    const t0 = Date.now();
    const resp = await fetch(GATEWAY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: upstream,
    });
    const elapsed_ms = Date.now() - t0;

    const bodyText = await resp.text();
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: `Gateway ${resp.status}: ${bodyText.slice(0, 500)}` }),
        { status: resp.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    let parsed: { text?: string; usage?: unknown } = {};
    try { parsed = JSON.parse(bodyText); } catch { /* fall through */ }

    return new Response(
      JSON.stringify({
        text: parsed.text ?? bodyText,
        usage: parsed.usage ?? null,
        model,
        elapsed_ms,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
