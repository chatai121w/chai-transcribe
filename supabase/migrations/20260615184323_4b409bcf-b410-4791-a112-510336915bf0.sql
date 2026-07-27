CREATE OR REPLACE FUNCTION public.edit_transcript_proxy(
  p_text text,
  p_action text,
  p_model text DEFAULT 'gemini-2.5-flash'::text,
  p_custom_prompt text DEFAULT NULL::text,
  p_tone_style text DEFAULT NULL::text,
  p_target_language text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_system_prompt TEXT;
  v_api_key       TEXT;
  v_api_url       TEXT;
  v_model_name    TEXT;
  v_response      extensions.http_response;
  v_result        JSONB;
  v_body          TEXT;
  v_uid           UUID;
  v_t0            TIMESTAMPTZ;
  v_dur_ms        INTEGER;
  v_out_text      TEXT;
  v_usage         JSONB;
  v_prompt_tok    INTEGER;
  v_comp_tok      INTEGER;
  v_total_tok     INTEGER;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;

  IF p_action = 'custom' AND p_custom_prompt IS NOT NULL THEN
    v_system_prompt := p_custom_prompt;
  ELSIF p_action = 'tone' THEN
    CASE COALESCE(p_tone_style, 'formal')
      WHEN 'formal'   THEN v_system_prompt := 'אתה עורך מקצועי. שכתב את הטקסט הבא בטון רשמי ומקצועי. השתמש בשפה מכובדת, הימנע מסלנג ומקיצורים. שמור על כל התוכן.';
      WHEN 'personal'  THEN v_system_prompt := 'אתה עורך מקצועי. שכתב את הטקסט הבא בטון אישי וחם. השתמש בגוף ראשון, הוסף נגיעה אישית. שמור על כל התוכן.';
      WHEN 'academic'  THEN v_system_prompt := 'אתה עורך אקדמי. שכתב את הטקסט הבא בסגנון אקדמי מחקרי. השתמש במונחים מקצועיים, הוסף מבנה אקדמי מתאים.';
      WHEN 'business'  THEN v_system_prompt := 'אתה עורך עסקי. שכתב את הטקסט הבא בסגנון עסקי מקצועי. תמציתי, ברור ומכוון לפעולה.';
      ELSE v_system_prompt := 'אתה עורך מקצועי. שכתב את הטקסט הבא בטון רשמי ומקצועי.';
    END CASE;
  ELSIF p_action = 'translate' THEN
    IF COALESCE(p_target_language, 'אנגלית') = 'עברית' THEN
      v_system_prompt := 'You are a professional translator. Translate the following text into Hebrew (עברית). Preserve the original meaning and style. Do not add notes — only the translation itself.';
    ELSE
      v_system_prompt := 'אתה מתרגם מקצועי. תרגם את הטקסט הבא ל' || COALESCE(p_target_language, 'אנגלית') || '. שמור על המשמעות והסגנון המקורי.';
    END IF;
  ELSE
    CASE p_action
      WHEN 'improve'         THEN v_system_prompt := 'אתה עורך מקצועי. שפר את הניסוח של הטקסט הבא כך שיהיה ברור ומקצועי יותר.';
      WHEN 'grammar'         THEN v_system_prompt := 'אתה מגיה מקצועי. תקן שגיאות דקדוק, כתיב ואיות בטקסט הבא.';
      WHEN 'punctuation'     THEN v_system_prompt := 'אתה עורך מקצועי. הוסף סימני פיסוק מתאימים לטקסט הבא.';
      WHEN 'readable'        THEN v_system_prompt := 'אתה עורך מקצועי. עשה את הטקסט הבא קריא וזורם יותר.';
      WHEN 'paragraphs'      THEN v_system_prompt := 'אתה עורך מקצועי. חלק את הטקסט הבא לפסקאות לוגיות.';
      WHEN 'headings'        THEN v_system_prompt := 'אתה עורך מקצועי. הוסף כותרת ראשית ותתי-כותרות מתאימות.';
      WHEN 'bullets'         THEN v_system_prompt := 'אתה עורך מקצועי. הפק רשימת נקודות מפתח מהטקסט הבא.';
      WHEN 'expand'          THEN v_system_prompt := 'אתה עורך מקצועי. הרחב את הטקסט הבא — הוסף פרטים, הסברים ודוגמאות.';
      WHEN 'shorten'         THEN v_system_prompt := 'אתה עורך מקצועי. קצר את הטקסט הבא לכמחצית מאורכו המקורי.';
      WHEN 'summarize'       THEN v_system_prompt := 'אתה עוזר שמסכם טקסטים בעברית. צור סיכום תמציתי של 3-5 משפטים.';
      WHEN 'sources'         THEN v_system_prompt := 'אתה עורך מחקרי. הוסף הערות ומקורות אפשריים לטקסט הבא.';
      WHEN 'speakers'        THEN v_system_prompt := E'אתה מומחה בזיהוי דוברים. נתח את הטקסט הבא וזהה דוברים שונים.';
      WHEN 'fix_errors'      THEN v_system_prompt := 'אתה עורך לשוני מקצועי בעברית. תקן את כל שגיאות הכתיב, הדקדוק והפיסוק.';
      WHEN 'split_paragraphs' THEN v_system_prompt := 'אתה עורך מקצועי. חלק את הטקסט הבא לפסקאות לוגיות לפי נושאים.';
      WHEN 'fix_and_split'   THEN v_system_prompt := 'אתה עורך לשוני מקצועי בעברית. תקן שגיאות וחלק לפסקאות לוגיות.';
      ELSE RETURN jsonb_build_object('error', 'Invalid action: ' || p_action);
    END CASE;
  END IF;

  BEGIN
    SELECT value INTO v_api_key FROM system_secrets WHERE key = 'AI_API_KEY';
    SELECT value INTO v_api_url FROM system_secrets WHERE key = 'AI_API_URL';
  EXCEPTION WHEN OTHERS THEN NULL; END;

  IF v_api_key IS NULL THEN
    BEGIN
      SELECT google_key INTO v_api_key
      FROM user_api_keys
      WHERE user_identifier = v_uid::text
        AND google_key IS NOT NULL AND google_key != ''
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    IF v_api_key IS NOT NULL THEN
      v_api_url := 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    END IF;
  END IF;

  IF v_api_key IS NULL THEN
    RETURN jsonb_build_object('error', 'לא הוגדר מפתח API. הוסף מפתח Google בהגדרות.');
  END IF;

  IF v_api_url IS NULL OR v_api_url = '' THEN
    v_api_url := 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  END IF;

  v_model_name := COALESCE(p_model, 'gemini-2.5-flash');
  IF v_model_name LIKE '%/%' THEN v_model_name := split_part(v_model_name, '/', 2); END IF;
  IF v_api_url LIKE '%generativelanguage.googleapis.com%' AND v_model_name NOT LIKE 'gemini%' THEN
    v_model_name := 'gemini-2.5-flash';
  END IF;

  v_body := jsonb_build_object(
    'model', v_model_name,
    'messages', jsonb_build_array(
      jsonb_build_object('role', 'system', 'content', v_system_prompt),
      jsonb_build_object('role', 'user', 'content', p_text)
    )
  )::text;

  v_t0 := clock_timestamp();
  SELECT * INTO v_response FROM extensions.http((
    'POST', v_api_url,
    ARRAY[
      extensions.http_header('Content-Type', 'application/json'),
      extensions.http_header('Authorization', 'Bearer ' || v_api_key)
    ],
    'application/json', v_body
  )::extensions.http_request);
  v_dur_ms := EXTRACT(MILLISECONDS FROM (clock_timestamp() - v_t0))::INTEGER;

  IF v_response.status >= 200 AND v_response.status < 300 THEN
    BEGIN
      v_result := v_response.content::jsonb;
      v_out_text := v_result->'choices'->0->'message'->>'content';
      v_usage := v_result->'usage';
      v_prompt_tok := COALESCE((v_usage->>'prompt_tokens')::INTEGER, 0);
      v_comp_tok   := COALESCE((v_usage->>'completion_tokens')::INTEGER, 0);
      v_total_tok  := COALESCE((v_usage->>'total_tokens')::INTEGER, v_prompt_tok + v_comp_tok);

      BEGIN
        INSERT INTO public.ai_usage_events (
          user_id, feature, model, prompt_tokens, completion_tokens, total_tokens,
          prompt_preview, system_prompt, response_preview, params, duration_ms
        ) VALUES (
          v_uid,
          'edit:' || p_action,
          'google/' || v_model_name,
          v_prompt_tok, v_comp_tok, v_total_tok,
          LEFT(p_text, 500),
          LEFT(v_system_prompt, 1000),
          LEFT(COALESCE(v_out_text, ''), 500),
          jsonb_build_object(
            'action', p_action,
            'tone_style', p_tone_style,
            'target_language', p_target_language,
            'custom_prompt', (p_action = 'custom' AND p_custom_prompt IS NOT NULL),
            'text_length', length(p_text),
            'via', 'db_proxy'
          ),
          v_dur_ms
        );
      EXCEPTION WHEN OTHERS THEN NULL; END;

      RETURN jsonb_build_object('text', v_out_text);
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('error', 'Failed to parse AI response: ' || SQLERRM);
    END;
  ELSIF v_response.status = 429 THEN
    RETURN jsonb_build_object('error', 'חרגת ממגבלת הבקשות. נסה שוב מאוחר יותר.');
  ELSIF v_response.status = 401 OR v_response.status = 403 THEN
    RETURN jsonb_build_object('error', 'מפתח API לא תקין. בדוק את ההגדרות.');
  ELSE
    RETURN jsonb_build_object('error', 'AI API error ' || v_response.status || ': ' || left(v_response.content, 300));
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', 'DB Proxy error: ' || SQLERRM);
END;
$function$;