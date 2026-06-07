// Cloud YouTube fetch — multi-backend fallback chain
//   1) Innertube (youtubei.js, iOS client) — direct YouTube internal API, no key
//   2) Self-hosted Cobalt (COBALT_SELFHOST_URL)
//   3) Piped instances (open source, REST, no key)
//   4) Invidious instances (open source, REST, no key)
//   5) Public Cobalt instances (best-effort, often rate-limited)
// Name kept as `youtube-cobalt` for backwards-compat with existing callers.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { Innertube } from 'npm:youtubei.js@13.4.0';

const SELFHOST = Deno.env.get('COBALT_SELFHOST_URL')?.trim();

const COBALT_INSTANCES = [
  ...(SELFHOST ? [SELFHOST.replace(/\/$/, '')] : []),
  'https://api.cobalt.tools',
  'https://co.eepy.today',
  'https://cobalt-api.kwiatekmiki.com',
];

// Piped — https://github.com/TeamPiped/Piped (public mirrors rotate)
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.r4fo.com',
  'https://pipedapi.leptons.xyz',
];

// Invidious — https://github.com/iv-org/invidious
const INVIDIOUS_INSTANCES = [
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://invidious.privacyredirect.com',
];

interface ReqBody {
  url: string;
  mode?: 'audio' | 'video';
  audioFormat?: 'best' | 'mp3' | 'opus' | 'wav' | 'm4a';
  videoQuality?: '144' | '240' | '360' | '480' | '720' | '1080' | 'max';
  action?: 'fetch' | 'info';
}

const YT_REGEX = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)[\w\-]+/;

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

async function fetchOEmbed(url: string) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { title: d.title as string, thumbnail: d.thumbnail_url as string, author: d.author_name as string };
  } catch {
    return null;
  }
}

// ── Backend: Piped ──────────────────────────────────────────────────────────
interface PipedStream {
  url: string;
  format?: string;
  mimeType?: string;
  bitrate?: number;
  quality?: string;
  videoOnly?: boolean;
}
interface PipedResponse {
  title?: string;
  uploader?: string;
  thumbnailUrl?: string;
  duration?: number;
  audioStreams?: PipedStream[];
  videoStreams?: PipedStream[];
}

async function tryPiped(videoId: string, opts: ReqBody): Promise<{ url: string; filename: string; title?: string; thumbnail?: string; author?: string; instance: string } | null> {
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'lovable-yt/1.0' },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as PipedResponse;
      let chosen: PipedStream | undefined;
      if (opts.mode === 'video') {
        const target = parseInt(opts.videoQuality ?? '720', 10);
        const muxed = (data.videoStreams ?? []).filter((s) => !s.videoOnly);
        chosen = muxed.sort((a, b) => {
          const da = Math.abs(parseInt(a.quality ?? '0') - target);
          const db = Math.abs(parseInt(b.quality ?? '0') - target);
          return da - db;
        })[0];
      } else {
        // audio
        chosen = (data.audioStreams ?? []).sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      }
      if (!chosen?.url) continue;
      const ext = (chosen.mimeType?.split('/')[1] ?? chosen.format ?? (opts.mode === 'video' ? 'mp4' : 'm4a')).split(';')[0];
      const safeTitle = (data.title ?? videoId).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
      return {
        url: chosen.url,
        filename: `${safeTitle}.${ext}`,
        title: data.title,
        thumbnail: data.thumbnailUrl,
        author: data.uploader,
        instance: `piped:${new URL(base).host}`,
      };
    } catch { /* try next */ }
  }
  return null;
}

// ── Backend: Invidious ──────────────────────────────────────────────────────
interface InvAdaptive { url: string; type?: string; bitrate?: string; container?: string; resolution?: string; encoding?: string; }
interface InvFormat { url: string; type?: string; qualityLabel?: string; container?: string; }
interface InvResponse {
  title?: string;
  author?: string;
  videoThumbnails?: Array<{ url: string }>;
  lengthSeconds?: number;
  adaptiveFormats?: InvAdaptive[];
  formatStreams?: InvFormat[];
}

async function tryInvidious(videoId: string, opts: ReqBody): Promise<{ url: string; filename: string; title?: string; thumbnail?: string; author?: string; instance: string } | null> {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'lovable-yt/1.0' },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as InvResponse;
      let chosen: { url: string; container?: string } | undefined;
      if (opts.mode === 'video') {
        // formatStreams are pre-muxed video+audio
        const target = parseInt(opts.videoQuality ?? '720', 10);
        chosen = (data.formatStreams ?? []).sort((a, b) => {
          const da = Math.abs(parseInt(a.qualityLabel ?? '0') - target);
          const db = Math.abs(parseInt(b.qualityLabel ?? '0') - target);
          return da - db;
        })[0];
      } else {
        const audios = (data.adaptiveFormats ?? []).filter((f) => f.type?.startsWith('audio/'));
        chosen = audios.sort((a, b) => parseInt(b.bitrate ?? '0') - parseInt(a.bitrate ?? '0'))[0];
      }
      if (!chosen?.url) continue;
      const ext = chosen.container ?? (opts.mode === 'video' ? 'mp4' : 'm4a');
      const safeTitle = (data.title ?? videoId).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
      const thumb = data.videoThumbnails?.[0]?.url;
      return {
        url: chosen.url,
        filename: `${safeTitle}.${ext}`,
        title: data.title,
        thumbnail: thumb,
        author: data.author,
        instance: `invidious:${new URL(base).host}`,
      };
    } catch { /* try next */ }
  }
  return null;
}

// ── Backend: Cobalt ─────────────────────────────────────────────────────────
async function tryCobalt(url: string, opts: ReqBody) {
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
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'lovable-yt/1.0' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(base === SELFHOST ? 20_000 : 6_000),
      });
      const data = await res.json();
      if (res.ok && (data.status === 'tunnel' || data.status === 'redirect' || data.status === 'stream')) {
        return { instance: `cobalt:${new URL(base).host}`, ...data };
      }
      if (data.error?.code) {
        lastErr = data.error.code;
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

// ── Backend: Innertube (youtubei.js) — direct YouTube internal API ─────────
// Reliable cloud path: bypasses public mirrors that are mostly dead in 2026.
async function tryInnertube(videoId: string, opts: ReqBody): Promise<{ url: string; filename: string; title?: string; thumbnail?: string; author?: string; instance: string } | null> {
  // iOS client returns pre-deciphered URLs; ANDROID/TV are extra fallbacks.
  const clients = ['iOS', 'ANDROID', 'TV'] as const;
  for (const client of clients) {
    try {
      const yt = await Innertube.create({ generate_session_locally: true });
      // deno-lint-ignore no-explicit-any
      const info = await yt.getBasicInfo(videoId, client as any);
      const fmt = opts.mode === 'video'
        ? info.chooseFormat({ type: 'video+audio', quality: (opts.videoQuality ?? '720') as never })
        : info.chooseFormat({ type: 'audio', quality: 'best' });
      let dlUrl: string | null = fmt?.url ?? null;
      if (!dlUrl && fmt?.decipher) {
        try { dlUrl = fmt.decipher(yt.session.player); } catch { /* try next client */ }
      }
      if (!dlUrl || !dlUrl.startsWith('http')) continue;
      const title = info.basic_info.title ?? videoId;
      const thumb = info.basic_info.thumbnail?.[0]?.url;
      const author = info.basic_info.author;
      const ext = (fmt.mime_type ?? '').includes('mp4') ? (opts.mode === 'video' ? 'mp4' : 'm4a')
        : (fmt.mime_type ?? '').includes('webm') ? 'webm' : 'm4a';
      const safe = title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
      return {
        url: dlUrl,
        filename: `${safe}.${ext}`,
        title,
        thumbnail: thumb,
        author,
        instance: `innertube:${client}`,
      };
    } catch { /* try next client */ }
  }
  return null;
}

// ── Orchestrator: try backends in order ─────────────────────────────────────
async function fetchWithFallbacks(url: string, opts: ReqBody) {
  const videoId = extractVideoId(url);
  const attempts: string[] = [];

  // 1) Innertube (most reliable cloud path, no infra)
  if (videoId) {
    try {
      const it = await tryInnertube(videoId, opts);
      if (it) return { status: 'redirect', ...it, attempts: [...attempts, 'innertube:ok'] };
      attempts.push('innertube:fail');
    } catch (e) {
      attempts.push(`innertube:${e instanceof Error ? e.message.slice(0, 60) : 'err'}`);
    }
  }

  // 2) Self-hosted Cobalt if configured
  if (SELFHOST) {
    try {
      const r = await tryCobalt(url, opts);
      return { ...r, attempts: [...attempts, 'cobalt-selfhost:ok'] };
    } catch (e) {
      attempts.push(`cobalt-selfhost:${e instanceof Error ? e.message : 'err'}`);
    }
  }

  // 3) Piped
  if (videoId) {
    const piped = await tryPiped(videoId, opts);
    if (piped) return { status: 'redirect', ...piped, attempts: [...attempts, 'piped:ok'] };
    attempts.push('piped:fail');
  }

  // 4) Invidious
  if (videoId) {
    const inv = await tryInvidious(videoId, opts);
    if (inv) return { status: 'redirect', ...inv, attempts: [...attempts, 'invidious:ok'] };
    attempts.push('invidious:fail');
  }

  // 4) Public Cobalt instances (last resort)
  try {
    const r = await tryCobalt(url, opts);
    return { ...r, attempts: [...attempts, 'cobalt-public:ok'] };
  } catch (e) {
    attempts.push(`cobalt-public:${e instanceof Error ? e.message : 'err'}`);
    throw new Error(`all backends failed — ${attempts.join(' | ')}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as ReqBody;
    if (!body?.url || !YT_REGEX.test(body.url)) {
      return new Response(JSON.stringify({ error: 'invalid_youtube_url' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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

    const result = await fetchWithFallbacks(body.url, body);
    const meta = await fetchOEmbed(body.url);

    return new Response(
      JSON.stringify({
        status: result.status,
        url: result.url,
        filename: result.filename,
        title: result.title ?? meta?.title ?? null,
        thumbnail: result.thumbnail ?? meta?.thumbnail ?? null,
        author: result.author ?? meta?.author ?? null,
        backend: 'cobalt',
        instance: result.instance,
        attempts: result.attempts,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
