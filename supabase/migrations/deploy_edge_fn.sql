-- =====================================================
-- Deploy Edge Function via Database (no CLI needed)
-- Requires: http extension enabled + system_secrets table with SUPABASE_MANAGEMENT_TOKEN
-- =====================================================

-- Function: deploy_edge_fn(slug, source_code)
-- Deploys an edge function to Supabase via the Management API
-- Uses the stored management token from system_secrets
CREATE OR REPLACE FUNCTION public.deploy_edge_fn(
  p_slug TEXT,
  p_source_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mgmt_token TEXT;
  project_ref TEXT := 'pycryoyipkymaqorgpjy';
  check_result extensions.http_response;
  deploy_result extensions.http_response;
  fn_exists BOOLEAN;
  deploy_method TEXT;
  deploy_url TEXT;
  deploy_body TEXT;
  response_body JSONB;
BEGIN
  -- Get management token from secure storage
  SELECT value INTO mgmt_token
  FROM public.system_secrets
  WHERE key = 'SUPABASE_MANAGEMENT_TOKEN';

  IF mgmt_token IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'error', 'SUPABASE_MANAGEMENT_TOKEN not found in system_secrets'
    );
  END IF;

  -- Check if function already exists
  SELECT * INTO check_result FROM extensions.http((
    'GET',
    'https://api.supabase.com/v1/projects/' || project_ref || '/functions/' || p_slug,
    ARRAY[extensions.http_header('Authorization', 'Bearer ' || mgmt_token)],
    NULL,
    NULL
  )::extensions.http_request);

  fn_exists := (check_result.status = 200);

  -- Build deploy request
  IF fn_exists THEN
    deploy_method := 'PATCH';
    deploy_url := 'https://api.supabase.com/v1/projects/' || project_ref || '/functions/' || p_slug;
    deploy_body := jsonb_build_object(
      'body', p_source_code,
      'verify_jwt', true
    )::TEXT;
  ELSE
    deploy_method := 'POST';
    deploy_url := 'https://api.supabase.com/v1/projects/' || project_ref || '/functions';
    deploy_body := jsonb_build_object(
      'slug', p_slug,
      'name', p_slug,
      'body', p_source_code,
      'verify_jwt', true
    )::TEXT;
  END IF;

  -- Deploy the function
  SELECT * INTO deploy_result FROM extensions.http((
    deploy_method,
    deploy_url,
    ARRAY[
      extensions.http_header('Authorization', 'Bearer ' || mgmt_token),
      extensions.http_header('Content-Type', 'application/json')
    ],
    'application/json',
    deploy_body
  )::extensions.http_request);

  -- Parse response
  BEGIN
    response_body := deploy_result.content::JSONB;
  EXCEPTION WHEN OTHERS THEN
    response_body := jsonb_build_object('raw', deploy_result.content);
  END;

  IF deploy_result.status >= 200 AND deploy_result.status < 300 THEN
    RETURN jsonb_build_object(
      'status', 'success',
      'slug', p_slug,
      'action', CASE WHEN fn_exists THEN 'updated' ELSE 'created' END,
      'http_status', deploy_result.status,
      'details', response_body
    );
  ELSE
    RETURN jsonb_build_object(
      'status', 'error',
      'slug', p_slug,
      'http_status', deploy_result.status,
      'error', response_body
    );
  END IF;
END;
$$;

-- Only authenticated users can call (admin check should be done in app layer)
GRANT EXECUTE ON FUNCTION public.deploy_edge_fn(TEXT, TEXT) TO authenticated;
