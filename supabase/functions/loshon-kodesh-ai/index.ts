import "../edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { logAIUsage } from "../_shared/aiUsage.ts";

const ALLOWED_ORIGINS = [
  'http://localhost:8080',
  'http://localhost:5173',
  'http://localhost:3000',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') || '';
  const isAllowed = ALLOWED_ORIGINS.includes(origin)
    || origin.endsWith('.lovable.app')
    || origin.endsWith('.lovableproject.com')
    || origin.endsWith('.trycloudflare.com');
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-info, x-supabase-client-version',
  };
}

const DEFAULT_PROMPT =
  'אתה מומחה בעברית תקנית ובהגייה אשכנזית של לשון הקודש. ' +
  'המר טקסט שתומלל פונטית מהגייה אשכנזית לכתיב עברי תקני. ' +
  'אל תוסיף תוכן, אל תפרש, אל תקצר — רק תקן כתיב והגייה. ' +
  'החזר את הטקסט המתוקן בלבד.';

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { text, prompt, model, vocabulary } = await req.json();
    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing text' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const systemPrompt = (prompt && typeof prompt === 'string' ? prompt : DEFAULT_PROMPT)
      + (Array.isArray(vocabulary) && vocabulary.length
          ? '\n\nאוצר מילים מועדף (כתיב קנוני — העדף צורות אלה כשמתאים):\n' + vocabulary.slice(0, 200).join(', ')
          : '');

    const aiModel = (typeof model === 'string' && model.trim()) ? model : 'google/gemini-2.5-flash';
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY is not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[loshon-kodesh-ai] model=${aiModel} chars=${text.length}`);

    const t0 = Date.now();
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
      }),
    });
    const durationMs = Date.now() - t0;

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: 'חרגת ממכסת הבקשות. נסה שוב מאוחר יותר.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: 'נגמרו קרדיטים ל-AI. הוסף קרדיטים בהגדרות סביבת העבודה.' }), {
        status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!response.ok) {
      const errTxt = await response.text();
      console.error('[loshon-kodesh-ai] gateway error', response.status, errTxt);
      return new Response(JSON.stringify({ error: `AI Gateway ${response.status}: ${errTxt.slice(0, 300)}` }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const out = data.choices?.[0]?.message?.content;
    if (!out) {
      return new Response(JSON.stringify({ error: 'AI לא החזיר תוכן' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Log usage (non-blocking) ──
    await logAIUsage({
      supabaseUserClient: userClient,
      userId: user.id,
      feature: 'loshon-kodesh',
      model: aiModel,
      usage: data.usage,
      promptText: text,
      systemPrompt,
      responseText: out,
      params: {
        text_length: text.length,
        vocabulary_size: Array.isArray(vocabulary) ? vocabulary.length : 0,
        custom_prompt: typeof prompt === 'string' && prompt.trim().length > 0,
      },
      durationMs,
    });


    return new Response(JSON.stringify({ text: out }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[loshon-kodesh-ai] error', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'שגיאה לא ידועה' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
