import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
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
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify the user is admin
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

    // Check admin role
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleData } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { sql, fileName, mode } = await req.json();

    if (!sql || typeof sql !== 'string') {
      return new Response(JSON.stringify({ error: 'SQL content is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const startTime = Date.now();
    let status = 'success';
    let result = '';
    let errorMessage = '';

    try {
      if (mode === 'debug') {
        // Debug mode: EXPLAIN ANALYZE the query
        const explainSql = `EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON) ${sql}`;
        const { data, error } = await adminClient.rpc('execute_sql_admin', { sql_text: explainSql });
        if (error) throw error;
        result = JSON.stringify(data, null, 2);
      } else {
        // Execute the migration
        const { data, error } = await adminClient.rpc('execute_sql_admin', { sql_text: sql });
        if (error) throw error;
        result = data ? JSON.stringify(data, null, 2) : 'Migration executed successfully';
      }
    } catch (err: any) {
      status = 'error';
      errorMessage = err.message || 'Unknown error occurred';
      result = '';
    }

    const executionTime = Date.now() - startTime;

    // Log the migration
    await adminClient.from('migration_logs').insert({
      user_id: user.id,
      sql_content: sql,
      status,
      result: result.substring(0, 10000), // Limit stored result
      error_message: errorMessage,
      execution_time_ms: executionTime,
      file_name: fileName || null,
    });

    return new Response(JSON.stringify({
      status,
      result,
      error: errorMessage || undefined,
      executionTime,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
