import "../edge-runtime.d.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

// Mirror of src/lib/prompts.ts — keep in sync (edge functions can't import from app)
const ACTION_PROMPTS: Record<string, string> = {
  improve: 'אתה עורך מקצועי. שפר את הניסוח של הטקסט הבא כך שיהיה ברור ומקצועי יותר. השאר את המשמעות והתוכן זהים, רק שפר את הניסוח והדקדוק.',
  grammar: 'אתה מגיה מקצועי. תקן שגיאות דקדוק, כתיב ואיות בטקסט הבא. אל תשנה את המשמעות או הסגנון, רק תקן שגיאות שפה. החזר את הטקסט המתוקן בלבד.',
  punctuation: 'אתה עורך מקצועי. הוסף סימני פיסוק מתאימים לטקסט הבא — נקודות, פסיקים, סימני שאלה וקריאה. וודא שהפיסוק תקין ומשפר את הקריאות. החזר את הטקסט עם הפיסוק בלבד.',
  readable: 'אתה עורך מקצועי. עשה את הטקסט הבא קריא וזורם יותר. חלק למשפטים קצרים, הוסף סימני פיסוק מתאימים, וודא שהטקסט קל לקריאה ולהבנה.',
  paragraphs: 'אתה עורך מקצועי. חלק את הטקסט הבא לפסקאות לוגיות. הוסף שורה ריקה בין פסקאות. אל תשנה את התוכן עצמו, רק את המבנה.',
  headings: 'אתה עורך מקצועי. הוסף כותרת ראשית ותתי-כותרות מתאימות לטקסט הבא. השתמש בסימון: # לכותרת ראשית, ## לתת-כותרת. שמור על כל התוכן המקורי.',
  bullets: 'אתה עורך מקצועי. הפק רשימת נקודות מפתח (bullet points) מהטקסט הבא. כל נקודה תהיה משפט קצר וברור. השתמש בתבליטים (•). שמור על כל המידע החשוב.',
  expand: 'אתה עורך מקצועי. הרחב את הטקסט הבא — הוסף פרטים, הסברים ודוגמאות. שמור על הנושא והסגנון המקורי. הפוך כל נקודה למפורטת יותר.',
  shorten: 'אתה עורך מקצועי. קצר את הטקסט הבא לכמחצית מאורכו המקורי. שמור על הנקודות החשובות ביותר. הסר חזרות ומידע משני.',
  summarize: 'אתה עוזר שמסכם טקסטים בעברית. צור סיכום תמציתי של 3-5 משפטים, תוך שמירה על נקודות המפתח החשובות ביותר. הסיכום חייב להיות בעברית.',
  sources: 'אתה עורך מחקרי. הוסף הערות ומקורות אפשריים לטקסט הבא. סמן מקומות שבהם כדאי להוסיף מקורות או ציטוטים עם [מקור נדרש]. אל תמציא מקורות, רק ציין היכן הם נחוצים.',
  speakers: 'אתה מומחה בזיהוי דוברים. נתח את הטקסט הבא (שנוצר מתמלול שיחה) וזהה את הדוברים השונים. סמן כל דובר עם תווית (דובר 1:, דובר 2: וכו\') בתחילת כל קטע דיבור שלו. אם לא ניתן להבחין — סמן עם [החלפת דובר].',
  custom: 'בצע את המשימה המבוקשת על הטקסט הבא.',
  fix_errors: 'אתה עורך לשוני מקצועי בעברית. תקן את כל שגיאות הכתיב, הדקדוק והפיסוק בטקסט הבא. אל תשנה את התוכן או המשמעות - רק תקן שגיאות. החזר את הטקסט המתוקן בלבד.',
  split_paragraphs: 'אתה עורך מקצועי. חלק את הטקסט הבא לפסקאות לוגיות לפי נושאים. הוסף שורה ריקה בין פסקאות. אל תשנה את התוכן עצמו, רק הוסף חלוקה לפסקאות במקומות המתאימים. החזר את הטקסט המחולק בלבד.',
  fix_and_split: 'אתה עורך לשוני מקצועי בעברית. בצע שני דברים על הטקסט הבא: 1) תקן את כל שגיאות הכתיב, הדקדוק והפיסוק. 2) חלק את הטקסט לפסקאות לוגיות לפי נושאים עם שורה ריקה ביניהן. אל תשנה את התוכן או המשמעות. החזר את הטקסט המתוקן והמחולק בלבד.',
};

const TONE_PROMPTS: Record<string, string> = {
  formal: 'אתה עורך מקצועי. שכתב את הטקסט הבא בטון רשמי ומקצועי. השתמש בשפה מכובדת, הימנע מסלנג ומקיצורים. שמור על כל התוכן.',
  personal: 'אתה עורך מקצועי. שכתב את הטקסט הבא בטון אישי וחם. השתמש בגוף ראשון, הוסף נגיעה אישית. שמור על כל התוכן.',
  academic: 'אתה עורך אקדמי. שכתב את הטקסט הבא בסגנון אקדמי מחקרי. השתמש במונחים מקצועיים, הוסף מבנה אקדמי מתאים.',
  business: 'אתה עורך עסקי. שכתב את הטקסט הבא בסגנון עסקי מקצועי. תמציתי, ברור ומכוון לפעולה.',
};

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify auth
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

    const { text, action, customPrompt, model, toneStyle, targetLanguage } = await req.json();
    
    if (!text || !action) {
      throw new Error('Missing text or action parameter');
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

    let systemPrompt = '';

    if (action === 'custom' && customPrompt) {
      systemPrompt = customPrompt;
    } else if (action === 'tone') {
      systemPrompt = TONE_PROMPTS[toneStyle || 'formal'] || TONE_PROMPTS.formal;
    } else if (action === 'translate') {
      const lang = targetLanguage || 'אנגלית';
      if (lang === 'עברית') {
        systemPrompt = 'You are a professional translator. Translate the following text into Hebrew (עברית). Preserve the original meaning and style. Do not add notes — only the translation itself.';
      } else {
        systemPrompt = `אתה מתרגם מקצועי. תרגם את הטקסט הבא ל${lang}. שמור על המשמעות והסגנון המקורי. אל תוסיף הערות — רק את התרגום עצמו.`;
      }
    } else {
      systemPrompt = ACTION_PROMPTS[action];
      if (!systemPrompt) {
        throw new Error(`Invalid action: ${action}`);
      }
    }

    console.log(`Processing ${action} action for text of length:`, text.length);

    const aiModel = model || 'google/gemini-2.5-flash';

    // Helper: fallback to DB proxy that uses the user's own Google API key
    const callDbProxy = async (): Promise<string> => {
      console.log('Falling back to DB proxy (user API key)…');
      const { data, error } = await userClient.rpc('edit_transcript_proxy', {
        p_text: text,
        p_action: action,
        p_model: aiModel,
        p_custom_prompt: customPrompt ?? null,
        p_tone_style: toneStyle ?? null,
        p_target_language: targetLanguage ?? null,
      });
      if (error) throw new Error(error.message);
      const payload = data as { text?: string; error?: string } | null;
      if (!payload || payload.error) {
        throw new Error(payload?.error || 'DB proxy returned no result');
      }
      if (!payload.text) throw new Error('DB proxy returned empty text');
      return payload.text;
    };

    let editedText: string | undefined;

    if (LOVABLE_API_KEY) {
      try {
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
              { role: 'user', content: text }
            ],
          }),
        });

        if (response.ok) {
          const data = await response.json();
          editedText = data.choices?.[0]?.message?.content;
        } else if (response.status === 402 || response.status === 429) {
          console.warn(`Lovable AI returned ${response.status}, falling back to user key`);
          editedText = await callDbProxy();
        } else {
          const errorText = await response.text();
          console.error('AI gateway error:', response.status, errorText);
          editedText = await callDbProxy();
        }
      } catch (e) {
        console.warn('Lovable AI failed, falling back:', e);
        editedText = await callDbProxy();
      }
    } else {
      editedText = await callDbProxy();
    }

    if (!editedText) {
      throw new Error('No response from AI');
    }

    console.log('Text editing completed successfully');

    return new Response(
      JSON.stringify({ text: editedText }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in edit-transcript:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'שגיאה לא ידועה' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
