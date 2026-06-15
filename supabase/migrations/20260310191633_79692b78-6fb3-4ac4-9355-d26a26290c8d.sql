CREATE OR REPLACE FUNCTION public.exec_sql(query text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_email text;
  t_start      timestamptz;
  t_end        timestamptz;
  row_count    bigint;
  stmt_type    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT email INTO caller_email
  FROM auth.users
  WHERE id = auth.uid();

  IF caller_email IS NULL OR caller_email NOT IN ('jj1212t@gmail.com') THEN
    RAISE EXCEPTION 'Admin access required — only authorized users can run migrations';
  END IF;

  stmt_type := upper(split_part(ltrim(regexp_replace(query, '/\*.*?\*/', '', 'g')), ' ', 1));

  t_start := clock_timestamp();
  EXECUTE query;
  GET DIAGNOSTICS row_count = ROW_COUNT;
  t_end := clock_timestamp();

  RETURN json_build_object(
    'success', true,
    'rows_affected', row_count,
    'duration_ms', round(extract(epoch from (t_end - t_start)) * 1000),
    'statement_type', stmt_type
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM,
      'detail', SQLSTATE,
      'hint', concat('Statement type: ', upper(split_part(ltrim(query), ' ', 1)))
    );
END;
$$;

REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.exec_sql(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO authenticated;

COMMENT ON FUNCTION public.exec_sql(text) IS 'Dev tool: run arbitrary SQL (admin only, SECURITY DEFINER)';