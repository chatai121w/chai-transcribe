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

    const { words } = await req.json();

    if (!words || !Array.isArray(words) || words.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing words array' }), {
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

    // Build context pairs for analysis
    const wordPairs = words.map((w: { word: string; prev?: string; next?: string; index: number }) => 
      `[${w.index}] ${w.prev ? w.prev + ' ' : ''}**${w.word}**${w.next ? ' ' + w.next : ''}`
    ).join('\n');

    const systemPrompt = `אתה מומחה בדקדוק ולשון עברית. נתח את המילים המסומנות ב-** בהקשר שלהן.

עבור כל מילה מסומנת (לפי אינדקס), בדוק:
1. האם המילה קיימת בעברית (מילה חוקית)?
2. האם הצורה הדקדוקית נכונה (נטייה, זמן, גוף, מין, מספר)?
3. האם המילה הגיונית בהקשר עם המילים הסמוכות?

חשוב:
- שמות עצם פרטיים, מילים לועזיות, מספרים — סמן כתקינים
- מילים עם שגיאות כתיב נפוצות — סמן עם הצעת תיקון
- צירופים לא הגיוניים — סמן עם הסבר`;

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
          { role: 'user', content: wordPairs }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'report_word_analysis',
              description: 'Report analysis results for each word',
              parameters: {
                type: 'object',
                properties: {
                  results: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        index: { type: 'number', description: 'Word index from input' },
                        exists: { type: 'boolean', description: 'Does the word exist in Hebrew?' },
                        grammarOk: { type: 'boolean', description: 'Is the grammatical form correct?' },
                        contextOk: { type: 'boolean', description: 'Does the word fit the context?' },
                        suggestion: { type: 'string', description: 'Suggested correction if any issue found' },
                        reason: { type: 'string', description: 'Brief explanation of the issue' },
                        issueType: { type: 'string', enum: ['none', 'spelling', 'grammar', 'context', 'unknown_word'], description: 'Type of issue found' }
                      },
                      required: ['index', 'exists', 'grammarOk', 'contextOk', 'issueType'],
                      additionalProperties: false
                    }
                  }
                },
                required: ['results'],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: 'function', function: { name: 'report_word_analysis' } },
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
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let results: any[] = [];
    
    if (toolCall?.function?.arguments) {
      try {
        const parsed = JSON.parse(toolCall.function.arguments);
        results = parsed.results || [];
      } catch (e) {
        console.error('Failed to parse tool call arguments:', e);
      }
    }

    return new Response(
      JSON.stringify({ results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in check-dictionary:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
