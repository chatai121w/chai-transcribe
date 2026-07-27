import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

/**
 * fetch-sefaria-text
 *
 * Fetches canonical Hebrew text from Sefaria's public API.
 * No API key required — Sefaria is a free, open Jewish library.
 *
 * Input (JSON): { ref: string }   e.g. "Psalms.119", "Psalms.119.1-10", "Mishnah Berakhot.1"
 * Output: { text: string, heRef: string, sectionRef: string, raw: any }
 */

interface SefariaResponse {
  he?: string | string[] | string[][];
  heRef?: string;
  sectionRef?: string;
  error?: string;
}

function flatten(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flatten).join(' ');
  return '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { ref } = await req.json().catch(() => ({}));
    if (!ref || typeof ref !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing "ref"' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = `https://www.sefaria.org/api/texts/${encodeURIComponent(ref)}?context=0&commentary=0&pad=0`;
    const upstream = await fetch(url, { headers: { Accept: 'application/json' } });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      return new Response(
        JSON.stringify({ error: `Sefaria ${upstream.status}: ${body.slice(0, 300)}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const data: SefariaResponse = await upstream.json();
    if (data.error) {
      return new Response(JSON.stringify({ error: data.error }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Strip HTML tags from Sefaria text (footnotes, brackets etc.)
    const raw = flatten(data.he);
    const text = raw
      .replace(/<sup[^>]*>.*?<\/sup>/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text) {
      return new Response(JSON.stringify({ error: 'No Hebrew text returned for that reference' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({
        text,
        heRef: data.heRef ?? ref,
        sectionRef: data.sectionRef ?? ref,
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
