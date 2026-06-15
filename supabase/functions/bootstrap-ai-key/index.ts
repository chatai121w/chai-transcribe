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

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify the caller is authenticated admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check it's the admin email
    if (user.email !== 'jj1212t@gmail.com') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get the keys from edge function env
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    const lovableUrl = 'https://ai.gateway.lovable.dev/v1/chat/completions';

    if (!lovableKey) {
      return new Response(JSON.stringify({ 
        error: 'LOVABLE_API_KEY not set in edge function secrets',
        hint: 'Add LOVABLE_API_KEY via Supabase Dashboard → Edge Functions → Secrets'
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service role to write to system_secrets (bypasses RLS)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    
    const { error: upsertError } = await adminClient
      .from('system_secrets')
      .upsert([
        { key: 'AI_API_KEY', value: lovableKey },
        { key: 'AI_API_URL', value: lovableUrl },
      ], { onConflict: 'key' });

    if (upsertError) {
      throw new Error('Failed to store secrets: ' + upsertError.message);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'AI_API_KEY and AI_API_URL stored in system_secrets',
      url: lovableUrl,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
