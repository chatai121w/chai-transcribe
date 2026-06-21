/**
 * AI Alignment Review Edge Function
 *
 * מקבל refText + hypText + רשימת candidates, פונה ל-Lovable AI Gateway
 * (gemini-2.5-flash) ומחזיר alignments מובנים עם הסבר וביטחון.
 */

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-userAgent, x-supabase-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  refText: string;
  hypText: string;
  candidates: Array<{ wrong: string; correct: string }>;
}

const SYSTEM_PROMPT = `אתה מומחה לעברית ולמערכות תמלול אוטומטי (ASR).
תפקידך לקבל טקסט קנוני (ref) שזה האמת, וטקסט שיצא ממנוע תמלול (hyp), ולנתח את ההבדלים.
לכל זוג מילים שלא תואם (wrong→correct), עליך:
1. לאשר או לדחות שזהו תיקון נכון.
2. להסביר *בקצרה* (משפט אחד) למה המנוע טעה (פונטיקה, הומופון, הקשר, מורפולוגיה, כתיב).
3. לתת ציון ביטחון 0-1 כמה אתה בטוח שהתיקון הזה נכון.

החזר תמיד JSON תקין במבנה:
{
  "alignments": [
    { "hyp": "...", "ref": "...", "reason": "...", "ruleType": "phonetic|context|homophone|morphology|spelling|other", "confidence": 0.0-1.0 }
  ],
  "summary": "סיכום של 1-2 משפטים על איכות התמלול הכוללת"
}

אל תוסיף טקסט מחוץ ל-JSON. אל תכלול alignments שאתה לא בטוח בהם (confidence < 0.3).`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY missing' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json()) as RequestBody;
    const hasTexts = !!(body?.refText && body?.hypText);
    const hasCandidates = Array.isArray(body?.candidates) && body.candidates.length > 0;
    if (!hasTexts && !hasCandidates) {
      return new Response(JSON.stringify({ error: 'יש לספק refText+hypText או candidates' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userPrompt = [
      hasTexts ? `## טקסט קנוני (אמת):\n${body.refText.slice(0, 8000)}` : '',
      hasTexts ? `\n## טקסט שהתקבל מהמנוע:\n${body.hypText.slice(0, 8000)}` : '',
      hasCandidates
        ? `\n## מועמדי תיקון לבדיקה (wrong → correct):\n${body.candidates
            .slice(0, 80)
            .map((c) => `- ${c.wrong} → ${c.correct}`)
            .join('\n')}`
        : '',
      hasTexts
        ? '\n## משימה:\nנתח את התיקונים והחזר JSON כפי שתואר במערכת.'
        : '\n## משימה:\nאין טקסט הקשר — הערך כל זוג wrong→correct באופן עצמאי לפי כללי עברית (פונטיקה, הומופונים, אותיות סופיות ך/ם/ן/ף/ץ, מורפולוגיה, כתיב). החזר JSON כפי שתואר.',
    ].filter(Boolean).join('\n');

    const aiResp = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: 'חרגת ממגבלת בקשות AI. נסה שוב מאוחר יותר.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: 'נגמרו קרדיטי AI. הוסף קרדיטים בהגדרות.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: `AI Gateway ${aiResp.status}: ${errText.slice(0, 300)}` }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const aiJson = await aiResp.json();
    const content = aiJson?.choices?.[0]?.message?.content ?? '{}';

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      parsed = { alignments: [] };
    }

    const alignments = Array.isArray(parsed?.alignments)
      ? parsed.alignments
          .filter((a: any) => a && typeof a.hyp === 'string' && typeof a.ref === 'string')
          .map((a: any) => ({
            hyp: String(a.hyp),
            ref: String(a.ref),
            reason: String(a.reason ?? ''),
            ruleType: ['phonetic', 'context', 'homophone', 'morphology', 'spelling', 'other'].includes(a.ruleType)
              ? a.ruleType
              : 'other',
            confidence: Math.max(0, Math.min(1, Number(a.confidence) || 0)),
          }))
      : [];

    return new Response(
      JSON.stringify({ alignments, summary: parsed?.summary ?? null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
