import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-region, x-supabase-client-info",
};

const ALLOWED_MODELS = new Set([
  "gemini-flash-latest",
  "gemini-pro-latest",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
]);
const DEFAULT_MODEL = "gemini-flash-latest";

// Google blocked gemini-2.5-* for new personal-API users → map to the -latest alias for the personal path.
function resolvePersonalModel(m: string): string {
  if (m === "gemini-2.5-flash") return "gemini-flash-latest";
  if (m === "gemini-2.5-pro") return "gemini-pro-latest";
  return m;
}

// Lovable AI Gateway only accepts explicit versioned ids (no -latest aliases).
function resolveGatewayModel(m: string): string {
  if (m === "gemini-flash-latest" || m === "gemini-2.0-flash") return "gemini-2.5-flash";
  if (m === "gemini-pro-latest" || m === "gemini-1.5-pro") return "gemini-2.5-pro";
  return m;
}


const buildPrompt = (lang: string) => {
  const langHint = lang === "he"
    ? "השפה היא עברית."
    : lang === "en"
    ? "The language is English."
    : lang === "yi"
    ? "השפה היא יידיש."
    : "זהה אוטומטית את השפה.";
  return `אתה מתמלל מקצועי. תמלל את קובץ האודיו המצורף במדויק, מילה במילה. ${langHint}\nהחזר אך ורק את הטקסט המתומלל, ללא הקדמות, הסברים, כותרות או סימני ציטוט.`;
};

async function fileToBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)) as never);
  }
  return btoa(binary);
}

async function callPersonalGoogle(params: {
  apiKey: string;
  model: string;
  mimeType: string;
  audioB64: string;
  lang: string;
}) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;
  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: buildPrompt(params.lang) },
        { inline_data: { mime_type: params.mimeType, data: params.audioB64 } },
      ],
    }],
    generationConfig: { temperature: 0.1 },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    // Auto-retry once if this model is blocked for new users
    if (res.status === 404 && /no longer available|not found/i.test(txt)) {
      const fb = params.model.includes("pro") ? "gemini-pro-latest" : "gemini-flash-latest";
      if (fb !== params.model) {
        return callPersonalGoogle({ ...params, model: fb });
      }
    }
    const exhausted = res.status === 429 || res.status === 403 || res.status === 401 ||
      /quota|exhausted|billing|RESOURCE_EXHAUSTED/i.test(txt);
    const err = new Error(`Google API ${res.status}: ${txt.slice(0, 200)}`);
    (err as { status?: number }).status = res.status;
    (err as { exhausted?: boolean }).exhausted = exhausted;
    throw err;
  }
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("").trim() || "";
  const usage = data?.usageMetadata as {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  } | undefined;
  return { text, usage };
}

async function callLovableGemini(params: {
  model: string;
  mimeType: string;
  audioB64: string;
  lang: string;
}) {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const gwModel = `google/${resolveGatewayModel(params.model)}`;
  // Lovable AI Gateway (OpenRouter-compatible) accepts inline audio for Gemini
  // as an image_url data URL. `input_audio` is OpenAI-only and rejected by google/*.
  const dataUrl = `data:${params.mimeType};base64,${params.audioB64}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: gwModel,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildPrompt(params.lang) },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      temperature: 0.1,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Lovable AI ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content || "";
  const usage = data?.usage;
  return { text: text.trim(), usage };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId };

  try {
    // Lightweight auth: accept any Authorization header (publishable key or user JWT).
    const authHeader = req.headers.get("Authorization") || "";
    let userId = "anon";
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data } = await userClient.auth.getUser();
      if (data?.user?.id) userId = data.user.id;
    } catch { /* ignore */ }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ error: "Missing audio file", requestId, stage: "validate" }), {
        status: 400, headers: jsonHeaders,
      });
    }
    const personalKey = (form.get("apiKey") as string | null)?.trim() || "";
    const modelRaw = ((form.get("model") as string | null) || DEFAULT_MODEL).replace(/^google\//, "");
    const model = ALLOWED_MODELS.has(modelRaw) ? modelRaw : DEFAULT_MODEL;
    const lang = (form.get("language") as string | null) || "he";
    const mimeType = file.type || "audio/mpeg";

    console.log(`[transcribe-gemini] req=${requestId} user=${userId} model=${model} lang=${lang} personal=${!!personalKey} size=${file.size}`);

    const audioB64 = await fileToBase64(file);

    let text = "";
    let usage: unknown = null;
    let provider: "personal" | "lovable" = "lovable";
    let fallbackReason: string | null = null;
    let personalStatus: number | null = null;
    let lovableError: { message: string; status?: number } | null = null;

    if (personalKey) {
      try {
        const r = await callPersonalGoogle({ apiKey: personalKey, model: resolvePersonalModel(model), mimeType, audioB64, lang });
        text = r.text; usage = r.usage; provider = "personal";
      } catch (e) {
        const exhausted = (e as { exhausted?: boolean }).exhausted;
        personalStatus = (e as { status?: number }).status ?? null;
        console.warn(`[transcribe-gemini] req=${requestId} personal key failed status=${personalStatus} exhausted=${exhausted}: ${(e as Error).message}`);
        fallbackReason = exhausted ? "personal_exhausted" : (e as Error).message;
      }
    }

    if (!text) {
      try {
        const r = await callLovableGemini({ model, mimeType, audioB64, lang });
        text = r.text; usage = r.usage; provider = "lovable";
      } catch (e) {
        const msg = (e as Error).message || "Lovable AI failed";
        const m = /Lovable AI (\d+)/.exec(msg);
        lovableError = { message: msg, status: m ? Number(m[1]) : undefined };
        console.error(`[transcribe-gemini] req=${requestId} lovable failed: ${msg}`);
      }
    }

    if (!text) {
      return new Response(
        JSON.stringify({
          error: "Gemini transcription failed",
          requestId,
          stage: personalKey && !lovableError ? "personal" : "lovable",
          model,
          provider: personalKey ? "personal→lovable" : "lovable",
          personalStatus,
          personalError: fallbackReason,
          lovableStatus: lovableError?.status ?? null,
          lovableError: lovableError?.message ?? null,
        }),
        { status: 502, headers: jsonHeaders },
      );
    }

    return new Response(
      JSON.stringify({ text, model, provider, fallbackReason, usage, requestId }),
      { headers: jsonHeaders },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[transcribe-gemini] req=${requestId} fatal:`, msg);
    return new Response(
      JSON.stringify({ error: msg, requestId, stage: "fatal" }),
      { status: 500, headers: jsonHeaders },
    );
  }
});

