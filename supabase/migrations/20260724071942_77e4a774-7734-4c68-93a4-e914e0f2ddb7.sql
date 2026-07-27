UPDATE public.user_api_keys
SET gemini_key = google_key
WHERE (gemini_key IS NULL OR gemini_key = '')
  AND google_key IS NOT NULL
  AND google_key <> '';