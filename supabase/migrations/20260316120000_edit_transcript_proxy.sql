-- ═══════════════════════════════════════════════════════════
-- edit_transcript_proxy: DB Function proxy for AI text editing
-- Replaces edge function "edit-transcript" — no deploy needed!
-- Uses http extension to call AI API directly from PostgreSQL.
-- Supports: Google Gemini (via user_api_keys), or any OpenAI-compatible
-- API configured in system_secrets (AI_API_KEY + AI_API_URL).
-- ═══════════════════════════════════════════════════════════

-- 1) Ensure http extension is available
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- 2) Ensure system_secrets table exists (for admin-level API keys)
CREATE TABLE IF NOT EXISTS public.system_secrets (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Only service_role and admin can read system_secrets
ALTER TABLE public.system_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Only service_role reads secrets" ON public.system_secrets;
CREATE POLICY "Only service_role reads secrets"
  ON public.system_secrets FOR SELECT
  USING (auth.role() = 'service_role');

-- 3) Create the proxy function
CREATE OR REPLACE FUNCTION public.edit_transcript_proxy(
  p_text           TEXT,
  p_action         TEXT,
  p_model          TEXT DEFAULT 'gemini-2.5-flash',
  p_custom_prompt  TEXT DEFAULT NULL,
  p_tone_style     TEXT DEFAULT NULL,
  p_target_language TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_system_prompt TEXT;
  v_api_key       TEXT;
  v_api_url       TEXT;
  v_model_name    TEXT;
  v_response      extensions.http_response;
  v_result        JSONB;
  v_body          TEXT;
  v_uid           UUID;
BEGIN
  -- ── Auth check ──
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Unauthorized');
  END IF;

  -- ── Build system prompt based on action ──
  IF p_action = 'custom' AND p_custom_prompt IS NOT NULL THEN
    v_system_prompt := p_custom_prompt;

  ELSIF p_action = 'tone' THEN
    CASE COALESCE(p_tone_style, 'formal')
      WHEN 'formal'   THEN v_system_prompt := 'אתה עורך מקצועי. שכתב את הטקסט הבא בטון רשמי ומקצועי. השתמש בשפה מכובדת, הימנע מסלנג ומקיצורים. שמור על כל התוכן.';
      WHEN 'personal'  THEN v_system_prompt := 'אתה עורך מקצועי. שכתב את הטקסט הבא בטון אישי וחם. השתמש בגוף ראשון, הוסף נגיעה אישית. שמור על כל התוכן.';
      WHEN 'academic'  THEN v_system_prompt := 'אתה עורך אקדמי. שכתב את הטקסט הבא בסגנון אקדמי מחקרי. השתמש במונחים מקצועיים, הוסף מבנה אקדמי מתאים.';
      WHEN 'business'  THEN v_system_prompt := 'אתה עורך עסקי. שכתב את הטקסט הבא בסגנון עסקי מקצועי. תמציתי, ברור ומכוון לפעולה.';
      ELSE v_system_prompt := 'אתה עורך מקצועי. שכתב את הטקסט הבא בטון רשמי ומקצועי. השתמש בשפה מכובדת, הימנע מסלנג ומקיצורים. שמור על כל התוכן.';
    END CASE;

  ELSIF p_action = 'translate' THEN
    IF COALESCE(p_target_language, 'אנגלית') = 'עברית' THEN
      v_system_prompt := 'You are a professional translator. Translate the following text into Hebrew (עברית). Preserve the original meaning and style. Do not add notes — only the translation itself.';
    ELSE
      v_system_prompt := 'אתה מתרגם מקצועי. תרגם את הטקסט הבא ל' || COALESCE(p_target_language, 'אנגלית') || '. שמור על המשמעות והסגנון המקורי. אל תוסיף הערות — רק את התרגום עצמו.';
    END IF;

  ELSE
    CASE p_action
      WHEN 'improve'         THEN v_system_prompt := 'אתה עורך מקצועי. שפר את הניסוח של הטקסט הבא כך שיהיה ברור ומקצועי יותר. השאר את המשמעות והתוכן זהים, רק שפר את הניסוח והדקדוק.';
      WHEN 'grammar'         THEN v_system_prompt := 'אתה מגיה מקצועי. תקן שגיאות דקדוק, כתיב ואיות בטקסט הבא. אל תשנה את המשמעות או הסגנון, רק תקן שגיאות שפה. החזר את הטקסט המתוקן בלבד.';
      WHEN 'punctuation'     THEN v_system_prompt := 'אתה עורך מקצועי. הוסף סימני פיסוק מתאימים לטקסט הבא — נקודות, פסיקים, סימני שאלה וקריאה. וודא שהפיסוק תקין ומשפר את הקריאות. החזר את הטקסט עם הפיסוק בלבד.';
      WHEN 'readable'        THEN v_system_prompt := 'אתה עורך מקצועי. עשה את הטקסט הבא קריא וזורם יותר. חלק למשפטים קצרים, הוסף סימני פיסוק מתאימים, וודא שהטקסט קל לקריאה ולהבנה.';
      WHEN 'paragraphs'      THEN v_system_prompt := 'אתה עורך מקצועי. חלק את הטקסט הבא לפסקאות לוגיות. הוסף שורה ריקה בין פסקאות. אל תשנה את התוכן עצמו, רק את המבנה.';
      WHEN 'headings'        THEN v_system_prompt := 'אתה עורך מקצועי. הוסף כותרת ראשית ותתי-כותרות מתאימות לטקסט הבא. השתמש בסימון: # לכותרת ראשית, ## לתת-כותרת. שמור על כל התוכן המקורי.';
      WHEN 'bullets'         THEN v_system_prompt := 'אתה עורך מקצועי. הפק רשימת נקודות מפתח (bullet points) מהטקסט הבא. כל נקודה תהיה משפט קצר וברור. השתמש בתבליטים (•). שמור על כל המידע החשוב.';
      WHEN 'expand'          THEN v_system_prompt := 'אתה עורך מקצועי. הרחב את הטקסט הבא — הוסף פרטים, הסברים ודוגמאות. שמור על הנושא והסגנון המקורי. הפוך כל נקודה למפורטת יותר.';
      WHEN 'shorten'         THEN v_system_prompt := 'אתה עורך מקצועי. קצר את הטקסט הבא לכמחצית מאורכו המקורי. שמור על הנקודות החשובות ביותר. הסר חזרות ומידע משני.';
      WHEN 'summarize'       THEN v_system_prompt := 'אתה עוזר שמסכם טקסטים בעברית. צור סיכום תמציתי של 3-5 משפטים, תוך שמירה על נקודות המפתח החשובות ביותר. הסיכום חייב להיות בעברית.';
      WHEN 'sources'         THEN v_system_prompt := 'אתה עורך מחקרי. הוסף הערות ומקורות אפשריים לטקסט הבא. סמן מקומות שבהם כדאי להוסיף מקורות או ציטוטים עם [מקור נדרש]. אל תמציא מקורות, רק ציין היכן הם נחוצים.';
      WHEN 'speakers'        THEN v_system_prompt := E'אתה מומחה בזיהוי דוברים. נתח את הטקסט הבא (שנוצר מתמלול שיחה) וזהה את הדוברים השונים. סמן כל דובר עם תווית (דובר 1:, דובר 2: וכו\') בתחילת כל קטע דיבור שלו. אם לא ניתן להבחין — סמן עם [החלפת דובר].';
      WHEN 'fix_errors'      THEN v_system_prompt := 'אתה עורך לשוני מקצועי בעברית. תקן את כל שגיאות הכתיב, הדקדוק והפיסוק בטקסט הבא. אל תשנה את התוכן או המשמעות - רק תקן שגיאות. החזר את הטקסט המתוקן בלבד.';
      WHEN 'split_paragraphs' THEN v_system_prompt := 'אתה עורך מקצועי. חלק את הטקסט הבא לפסקאות לוגיות לפי נושאים. הוסף שורה ריקה בין פסקאות. אל תשנה את התוכן עצמו, רק הוסף חלוקה לפסקאות במקומות המתאימים. החזר את הטקסט המחולק בלבד.';
      WHEN 'fix_and_split'   THEN v_system_prompt := 'אתה עורך לשוני מקצועי בעברית. בצע שני דברים על הטקסט הבא: 1) תקן את כל שגיאות הכתיב, הדקדוק והפיסוק. 2) חלק את הטקסט לפסקאות לוגיות לפי נושאים עם שורה ריקה ביניהן. אל תשנה את התוכן או המשמעות. החזר את הטקסט המתוקן והמחולק בלבד.';
      ELSE
        RETURN jsonb_build_object('error', 'Invalid action: ' || p_action);
    END CASE;
  END IF;

  -- ── Get API key ──
  -- Priority 1: system-level key (admin configured)
  BEGIN
    SELECT value INTO v_api_key FROM system_secrets WHERE key = 'AI_API_KEY';
    SELECT value INTO v_api_url FROM system_secrets WHERE key = 'AI_API_URL';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Priority 2: user's google_key from user_api_keys
  IF v_api_key IS NULL THEN
    BEGIN
      SELECT google_key INTO v_api_key
      FROM user_api_keys
      WHERE user_identifier = v_uid::text
        AND google_key IS NOT NULL
        AND google_key != ''
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- Default to Google Gemini OpenAI-compatible endpoint
    IF v_api_key IS NOT NULL THEN
      v_api_url := 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    END IF;
  END IF;

  IF v_api_key IS NULL THEN
    RETURN jsonb_build_object('error', 'לא הוגדר מפתח API. הוסף מפתח Google בהגדרות, או בקש מהמנהל להגדיר AI_API_KEY ב-system_secrets.');
  END IF;

  -- Default URL if admin set key but no URL
  IF v_api_url IS NULL OR v_api_url = '' THEN
    v_api_url := 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  END IF;

  -- ── Resolve model name ──
  -- Strip provider prefix (e.g. "google/gemini-2.5-flash" → "gemini-2.5-flash")
  v_model_name := COALESCE(p_model, 'gemini-2.5-flash');
  IF v_model_name LIKE '%/%' THEN
    v_model_name := split_part(v_model_name, '/', 2);
  END IF;

  -- If using Google API with a non-Google model, fallback to gemini
  IF v_api_url LIKE '%generativelanguage.googleapis.com%'
     AND v_model_name NOT LIKE 'gemini%' THEN
    v_model_name := 'gemini-2.5-flash';
  END IF;

  -- ── Build request body (OpenAI chat/completions format) ──
  v_body := jsonb_build_object(
    'model', v_model_name,
    'messages', jsonb_build_array(
      jsonb_build_object('role', 'system', 'content', v_system_prompt),
      jsonb_build_object('role', 'user', 'content', p_text)
    )
  )::text;

  -- ── Call AI API via http extension ──
  SELECT * INTO v_response
  FROM extensions.http((
    'POST',
    v_api_url,
    ARRAY[
      extensions.http_header('Content-Type', 'application/json'),
      extensions.http_header('Authorization', 'Bearer ' || v_api_key)
    ],
    'application/json',
    v_body
  )::extensions.http_request);

  -- ── Parse response ──
  IF v_response.status >= 200 AND v_response.status < 300 THEN
    BEGIN
      v_result := v_response.content::jsonb;
      RETURN jsonb_build_object(
        'text', v_result->'choices'->0->'message'->>'content'
      );
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('error', 'Failed to parse AI response: ' || SQLERRM);
    END;
  ELSIF v_response.status = 429 THEN
    RETURN jsonb_build_object('error', 'חרגת ממגבלת הבקשות. נסה שוב מאוחר יותר.');
  ELSIF v_response.status = 401 OR v_response.status = 403 THEN
    RETURN jsonb_build_object('error', 'מפתח API לא תקין. בדוק את ההגדרות.');
  ELSE
    RETURN jsonb_build_object(
      'error', 'AI API error ' || v_response.status || ': ' || left(v_response.content, 300)
    );
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'DB Proxy error: ' || SQLERRM);
END;
$$;

-- 4) Grant access
GRANT EXECUTE ON FUNCTION public.edit_transcript_proxy(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.edit_transcript_proxy(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;

COMMENT ON FUNCTION public.edit_transcript_proxy IS 'DB proxy for AI text editing — replaces edit-transcript edge function. No deployment needed.';
