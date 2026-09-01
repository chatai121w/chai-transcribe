import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-region, x-supabase-client-info",
};

// Minimal 1-second silent WAV (mono, 8kHz, 16-bit)
function tinyWavBase64(): string {
  const sampleRate = 8000;
  const numSamples = 800; // 0.1s
  const byteRate = sampleRate * 2;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); view.setUint32(4, 36 + dataSize, true); w(8, "WAVE");
  w(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  w(36, "data"); view.setUint32(40, dataSize, true);
  // samples remain zero
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function checkPersonal(apiKey: string, model: string) {
  const t0 = Date.now();
  // Cheap validation: listModels endpoint — verifies auth without spending tokens.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { method: "GET" });
    const ms = Date.now() - t0;
    if (res.ok) {
      const j = await res.json().catch(() => ({}));
      return { ok: true, status: res.status, latencyMs: ms, modelFound: j?.name || model, note: "מפתח תקין והמודל זמין" };
    }
    const txt = await res.text().catch(() => "");
    let hint = "";
    if (res.status === 400) hint = "מפתח לא תקין או פורמט שגוי";
    else if (res.status === 401 || res.status === 403) hint = "מפתח נדחה — בדוק הרשאות ו-Billing ב-Google AI Studio";
    else if (res.status === 404) hint = "המודל לא זמין למפתח הזה";
    else if (res.status === 429) hint = "חריגת מכסה";
    return { ok: false, status: res.status, latencyMs: ms, error: txt.slice(0, 300), hint };
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - t0, error: (e as Error).message, hint: "שגיאת רשת" };
  }
}

async function checkLovable(model: string) {
  const t0 = Date.now();
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return { ok: false, status: 0, latencyMs: 0, error: "LOVABLE_API_KEY חסר", hint: "לא הוגדר בפרויקט" };
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `google/${resolveGatewayModel(model)}`,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
      }),
    });
    const ms = Date.now() - t0;
    if (res.ok) return { ok: true, status: res.status, latencyMs: ms, note: "שער Lovable AI מגיב" };
    const txt = await res.text().catch(() => "");
    let hint = "";
    if (res.status === 402) hint = "אזל קרדיט Lovable AI";
    else if (res.status === 429) hint = "חריגת מכסה זמנית";
    else if (res.status === 401) hint = "מפתח Lovable לא תקין";
    return { ok: false, status: res.status, latencyMs: ms, error: txt.slice(0, 300), hint };
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - t0, error: (e as Error).message, hint: "שגיאת רשת" };
  }
}

async function checkAudioFormat(personalKey: string | null, model: string) {
  // Send a tiny 0.1s WAV to verify the audio input pipeline actually accepts multimodal input.
  const t0 = Date.now();
  const audioB64 = tinyWavBase64();
  try {
    if (personalKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(personalKey)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: "Respond with the single word: OK" },
              { inline_data: { mime_type: "audio/wav", data: audioB64 } },
            ],
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 5 },
        }),
      });
      const ms = Date.now() - t0;
      if (res.ok) return { ok: true, status: 200, latencyMs: ms, provider: "personal", note: "פורמט אודיו מתקבל" };
      const t = await res.text().catch(() => "");
      return { ok: false, status: res.status, latencyMs: ms, provider: "personal", error: t.slice(0, 300), hint: "המודל דחה את פורמט האודיו" };
    }
    // Lovable path: image_url data URL (this is the format the transcribe function uses).
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return { ok: false, status: 0, latencyMs: 0, provider: "lovable", error: "LOVABLE_API_KEY חסר" };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `google/${resolveGatewayModel(model)}`,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Respond with OK." },
            { type: "image_url", image_url: { url: `data:audio/wav;base64,${audioB64}` } },
          ],
        }],
        max_tokens: 5,
      }),
    });
    const ms = Date.now() - t0;
    if (res.ok) return { ok: true, status: 200, latencyMs: ms, provider: "lovable", note: "פורמט אודיו מתקבל" };
    const t = await res.text().catch(() => "");
    return { ok: false, status: res.status, latencyMs: ms, provider: "lovable", error: t.slice(0, 300), hint: "השער דחה את פורמט האודיו" };
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - t0, error: (e as Error).message, hint: "שגיאת רשת" };
  }
}

function resolveGatewayModel(m: string): string {
  if (m === "gemini-flash-latest" || m === "gemini-2.0-flash" || m === "gemini-3.5-transcribe") return "gemini-2.5-flash";
  if (m === "gemini-pro-latest" || m === "gemini-1.5-pro") return "gemini-2.5-pro";
  return m;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const requestId = crypto.randomUUID();
  const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId };
  try {
    const body = await req.json().catch(() => ({}));
    const personalKey = (body.apiKey as string | undefined)?.trim() || "";
    const rawModel = ((body.model as string | undefined) || "gemini-flash-latest").replace(/^google\//, "");
    // Google blocked gemini-2.5-* for new personal-API users → map to -latest for the personal probe.
    const personalModel = rawModel === "gemini-2.5-flash" ? "gemini-flash-latest"
      : rawModel === "gemini-2.5-pro" ? "gemini-pro-latest"
      : rawModel;
    const model = rawModel;

    const results: Record<string, unknown> = { requestId, model, personalModel, hasPersonalKey: !!personalKey };

    if (personalKey) {
      results.personalAuth = await checkPersonal(personalKey, personalModel);
    }
    results.lovable = await checkLovable(model);
    results.audioFormat = await checkAudioFormat(personalKey || null, personalKey ? personalModel : model);

    const authOk = personalKey ? (results.personalAuth as { ok?: boolean }).ok : (results.lovable as { ok?: boolean }).ok;
    const formatOk = (results.audioFormat as { ok?: boolean }).ok;
    results.overall = authOk && formatOk ? "ok" : (authOk ? "audio_format_issue" : "auth_issue");

    return new Response(JSON.stringify(results), { headers: jsonHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message, requestId }), { status: 500, headers: jsonHeaders });
  }
});
