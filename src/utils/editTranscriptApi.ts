import { supabase } from "@/integrations/supabase/client";
import { buildHebrewGuardPrefix } from "@/lib/hebrewGuard";
import { ACTION_PROMPTS, TONE_PROMPTS } from "@/lib/prompts";
import {
  isPersonalGeminiEnabled,
  callPersonalGemini,
  PersonalGeminiExhaustedError,
  PersonalGeminiTransientError,
  getPersonalGeminiModel,
  recordLovableGatewayUsage,
  isGeminiModel,
} from "@/lib/personalGemini";
import { toast } from "sonner";

interface EditTranscriptParams {
  text: string;
  action: string;
  model?: string;
  customPrompt?: string;
  toneStyle?: string;
  targetLanguage?: string;
  signal?: AbortSignal;
  personalGeminiTimeoutMs?: number;
}

/**
 * Call AI text editing — tries DB proxy first, falls back to edge function.
 * DB proxy = always up-to-date code (no deploy needed).
 * Edge function = fallback if DB proxy fails (no API key, etc).
 */
export async function editTranscriptCloud(params: EditTranscriptParams): Promise<string> {
  const { text, model, toneStyle, targetLanguage, signal } = params;
  let { action, customPrompt } = params;
  let forceLovableGateway = false;

  // Quick transcript actions are local UI names. Route them as explicit prompts
  // so older cloud functions do not reject them as unknown actions.
  if (['fix_errors', 'split_paragraphs', 'fix_and_split'].includes(action)) {
    customPrompt = ACTION_PROMPTS[action];
    action = 'custom';
  }

  // ── Hebrew-only output guard: convert to action='custom' with prefixed prompt ──
  const hebrewPrefix = buildHebrewGuardPrefix(action);
  if (hebrewPrefix) {
    let basePrompt = '';
    if (action === 'custom' && customPrompt) basePrompt = customPrompt;
    else if (action === 'tone') basePrompt = TONE_PROMPTS[toneStyle || 'formal'] || TONE_PROMPTS.formal;
    else basePrompt = (ACTION_PROMPTS as Record<string, string>)[action] || '';
    if (basePrompt) {
      action = 'custom';
      customPrompt = hebrewPrefix + '\n' + basePrompt;
    }
  }

  // ── Personal Gemini path: try user's key first, fall back to Lovable on exhaustion ──
  if (isPersonalGeminiEnabled() && isGeminiModel(model || getPersonalGeminiModel())) {
    let systemPrompt = '';
    if ((action === 'custom' || action === 'translate') && customPrompt) systemPrompt = customPrompt;
    else if (action === 'tone') systemPrompt = TONE_PROMPTS[toneStyle || 'formal'] || TONE_PROMPTS.formal;
    else systemPrompt = (ACTION_PROMPTS as Record<string, string>)[action] || ACTION_PROMPTS.improve;
    if (targetLanguage) systemPrompt += `\nהחזר את הטקסט בשפה: ${targetLanguage}`;
    systemPrompt += '\nהחזר את הטקסט הסופי בלבד, ללא הסברים.';
    const personalController = new AbortController();
    const abortPersonal = () => personalController.abort();
    signal?.addEventListener('abort', abortPersonal, { once: true });
    let personalTimedOut = false;
    const personalTimeoutId = params.personalGeminiTimeoutMs
      ? window.setTimeout(() => {
          personalTimedOut = true;
          personalController.abort();
        }, params.personalGeminiTimeoutMs)
      : undefined;
    try {
      return await callPersonalGemini({
        systemPrompt,
        userPrompt: text,
        model: model || getPersonalGeminiModel(),
        temperature: 0.3,
        surface: "editing",
        signal: personalController.signal,
      });

    } catch (e) {
      if (signal?.aborted) throw e;
      forceLovableGateway = true;
      try {
        toast.warning(personalTimedOut
          ? "Gemini האישי לא הגיב בזמן — עוברים אוטומטית לקרדיטים של Lovable"
          : e instanceof PersonalGeminiTransientError
          ? "Gemini עמוס זמנית — עוברים אוטומטית לקרדיטים של Lovable"
          : e instanceof PersonalGeminiExhaustedError
            ? "מפתח Gemini האישי אינו זמין — עוברים אוטומטית לקרדיטים של Lovable"
            : "Gemini האישי נכשל — עוברים אוטומטית לקרדיטים של Lovable");
      } catch { /* noop */ }
    } finally {
      if (personalTimeoutId !== undefined) window.clearTimeout(personalTimeoutId);
      signal?.removeEventListener('abort', abortPersonal);
    }
  }



  const routeModel = model || 'gemini-2.5-flash';
  // The deployed DB proxy already honors custom prompts reliably. Keep the
  // public action as "translate" (so the Hebrew guard stays disabled), but
  // route the proxy call through its custom-prompt branch.
  const proxyAction = action === 'translate' && customPrompt ? 'custom' : action;

  // ── Try DB proxy first (latest code, no deployment needed) ──
  if (!forceLovableGateway) try {
    const request = (supabase.rpc as any)('edit_transcript_proxy', {
      p_text: text,
      p_action: proxyAction,
      p_model: routeModel,
      p_custom_prompt: customPrompt || null,
      p_tone_style: toneStyle || null,
      p_target_language: targetLanguage || null,
    });
    const { data, error } = await (signal ? request.abortSignal(signal) : request);

    const result = data as { text?: string; error?: string } | null;
    if (!error && result && !result.error && result.text) {
      // DB proxy routes through the user's stored Google key when present,
      // otherwise through Lovable's shared credentials. Either way it is NOT
      // the client-side personal path, so count it under the Lovable route.
      recordLovableGatewayUsage(routeModel, 0, 0, "editing");
      return result.text;
    }

    // DB proxy returned an error — log it and fall through to edge function
    const proxyError = error?.message || result?.error || 'Unknown DB proxy error';
    console.warn('DB proxy failed, trying edge function:', proxyError);
  } catch (e) {
    if (signal?.aborted) throw new DOMException('התרגום בוטל', 'AbortError');
    console.warn('DB proxy exception, trying edge function:', e);
  }

  if (signal?.aborted) throw new DOMException('התרגום בוטל', 'AbortError');

  // ── Fallback: edge function (Lovable AI Gateway) ──
  const body: Record<string, string> = { text, action };
  if (model) {
    const bareModel = model.replace(/^cloud:/, '').replace(/^google\//, '');
    const gatewayModel = bareModel === 'gemini-flash-latest'
      ? 'gemini-2.5-flash'
      : bareModel === 'gemini-pro-latest'
        ? 'gemini-2.5-pro'
        : bareModel;
    body.model = isGeminiModel(gatewayModel) ? `google/${gatewayModel}` : model;
  }
  if (customPrompt) body.customPrompt = customPrompt;
  if (toneStyle) body.toneStyle = toneStyle;
  if (targetLanguage) body.targetLanguage = targetLanguage;

  const { data, error } = await supabase.functions.invoke('edit-transcript', { body });
  if (error) throw error;
  if (!data?.text) throw new Error('לא התקבלה תשובה מ-AI');
  const usage = (data?.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
  recordLovableGatewayUsage(routeModel, usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, "editing");
  return data.text;
}
