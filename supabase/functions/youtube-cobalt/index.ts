// Cloud fallback for YouTube downloads using Cobalt API
// https://github.com/imputnet/cobalt
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

// Self-hosted Cobalt comes first when configured (Railway / Fly / etc).
// Public instances are a best-effort last resort — they're often rate-limited or down.
const SELFHOST = Deno.env.get('COBALT_SELFHOST_URL')?.trim();
const COBALT_INSTANCES = [
  ...(SELFHOST ? [SELFHOST.replace(/\/$/, '')] : []),
  'https://api.cobalt.tools',
  'https://co.eepy.today',
  'https://cobalt-api.kwiatekmiki.com',
];

interface ReqBody {
  url: string;
  mode?: 'audio' | 'video';        // default audio
  audioFormat?: 'best' | 'mp3' | 'opus' | 'wav' | 'm4a';
  videoQuality?: '144' | '240' | '360' | '480' | '720' | '1080' | 'max';
  action?: 'fetch' | 'info';       // 'info' returns minimal metadata only
}

const YT_REGEX = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w\-]+/;

// Try to extract video ID for oEmbed metadata (works without API key)
function extractVideoId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

async function fetchOEmbed(url: string): Promise<{ title?: string; thumbnail?: string; author?: string } | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return null;
    const d = await res.json();
    return { title: d.title, thumbnail: d.thumbnail_url, author: d.author_name };
  } catch {
    return null;
  }
}

async function callCobalt(url: string, opts: ReqBody) {
  const payload = {
    url,
    downloadMode: opts.mode === 'video' ? 'auto' : 'audio',
    audioFormat: opts.audioFormat && opts.audioFormat !== 'm4a' ? opts.audioFormat : 'best',
    audioBitrate: '128',
    videoQuality: opts.videoQuality ?? '720',
    filenameStyle: 'pretty',
    youtubeVideoCodec: 'h264',
  };

  let lastErr: unknown = null;
  for (const base of COBALT_INSTANCES) {
    try {
      const res = await fetch(`${base}/`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'lovable-yt/1.0',
        },
        body: JSON.stringify(payload),
        // Self-host gets more time; public instances must fail fast so the user isn't stuck on a 502.
        signal: AbortSignal.timeout(base === SELFHOST ? 20_000 : 6_000),
      });
      const data = await res.json();
      if (res.ok && (data.status === 'tunnel' || data.status === 'redirect' || data.status === 'stream')) {
        return { instance: base, ...data };
      }
      if (data.error?.code) {
        lastErr = data.error.code;
        // permanent errors — don't retry other instances
        if (['error.api.content.video.unavailable', 'error.api.content.post.unavailable', 'error.api.link.invalid'].includes(data.error.code)) {
          throw new Error(data.error.code);
        }
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(typeof lastErr === 'string' ? lastErr : 'all_cobalt_instances_failed');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as ReqBody;
    if (!body?.url || !YT_REGEX.test(body.url)) {
      return new Response(
        JSON.stringify({ error: 'invalid_youtube_url' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // info-only: return oEmbed metadata
    if (body.action === 'info') {
      const meta = await fetchOEmbed(body.url);
      return new Response(
        JSON.stringify({
          videoId: extractVideoId(body.url),
          title: meta?.title ?? null,
          thumbnail: meta?.thumbnail ?? null,
          author: meta?.author ?? null,
          backend: 'cobalt',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // fetch stream URL via Cobalt
    const cobaltRes = await callCobalt(body.url, body);
    const meta = await fetchOEmbed(body.url);

    return new Response(
      JSON.stringify({
        status: cobaltRes.status,         // tunnel | redirect | stream
        url: cobaltRes.url,               // direct download URL
        filename: cobaltRes.filename,
        title: meta?.title ?? null,
        thumbnail: meta?.thumbnail ?? null,
        author: meta?.author ?? null,
        backend: 'cobalt',
        instance: cobaltRes.instance,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
