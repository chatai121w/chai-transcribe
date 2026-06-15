import "../edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { text, learnedCorrections } = await req.json();

    if (!text || typeof text !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing text parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY is not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build context from learned corrections
    let learnedContext = '';
    if (learnedCorrections && Array.isArray(learnedCorrections) && learnedCorrections.length > 0) {
      const examples = learnedCorrections.slice(0, 30).map(
        (c: { original: string; corrected: string }) => `"${c.original}" → "${c.corrected}"`
      ).join('\n');
      learnedContext = `\n\nהנה תיקונים שהמשתמש ביצע בעבר, השתמש בהם כהנחיה לזיהוי שגיאות דומות:\n${examples}`;
    }

    const systemPrompt = `אתה בודק איות ודקדוק מומחה בעברית. מצא שגיאות כתיב, איות, מילים שגויות או לא קיימות בטקסט הבא.

עבור כל שגיאה, החזר:
- word: המילה השגויה כפי שמופיעה בטקסט
- suggestions: מערך של 1-3 הצעות תיקון (הטובה ביותר ראשונה)
- reason: הסבר קצר מדוע זו שגיאה

חשוב:
- אל תסמן מילים תקינות כשגויות
- התמקד בשגיאות כתיב ואיות בעברית
- שים לב למילים עם אותיות דומות (כ/ק, ת/ט, ש/ס, ח/כ)
- זהה מילים שלא קיימות בעברית
- אל תסמן שמות עצם, מילים לועזיות, או קיצורים כשגויות
${learnedContext}`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'report_spelling_errors',
              description: 'Report spelling errors found in the text',
              parameters: {
                type: 'object',
                properties: {
                  errors: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        word: { type: 'string', description: 'The misspelled word as it appears in the text' },
                        suggestions: {
                          type: 'array',
                          items: { type: 'string' },
                          description: '1-3 suggested corrections, best first'
                        },
                        reason: { type: 'string', description: 'Brief explanation of the error' }
                      },
                      required: ['word', 'suggestions', 'reason'],
                      additionalProperties: false
                    }
                  }
                },
                required: ['errors'],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: 'function', function: { name: 'report_spelling_errors' } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Payment required' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      return new Response(JSON.stringify({ error: 'AI gateway error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    
    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let errors: Array<{ word: string; suggestions: string[]; reason: string }> = [];
    
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        errors = parsed.errors || [];
      } catch (e) {
        console.error('Failed to parse tool call arguments:', e);
      }
    }

    return new Response(
      JSON.stringify({ errors }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in check-spelling:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
