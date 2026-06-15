import { supabase } from "@/integrations/supabase/client";
import { buildHebrewGuardPrefix } from "@/lib/hebrewGuard";
import { ACTION_PROMPTS, TONE_PROMPTS } from "@/lib/prompts";

interface EditTranscriptParams {
  text: string;
  action: string;
  model?: string;
  customPrompt?: string;
  toneStyle?: string;
  targetLanguage?: string;
}

/**
 * Call AI text editing — tries DB proxy first, falls back to edge function.
 * DB proxy = always up-to-date code (no deploy needed).
 * Edge function = fallback if DB proxy fails (no API key, etc).
 */
export async function editTranscriptCloud(params: EditTranscriptParams): Promise<string> {
  let { text, action, model, customPrompt, toneStyle, targetLanguage } = params;

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

  // ── Try DB proxy first (latest code, no deployment needed) ──
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('edit_transcript_proxy', {
      p_text: text,
      p_action: action,
      p_model: model || 'gemini-2.5-flash',
      p_custom_prompt: customPrompt || null,
      p_tone_style: toneStyle || null,
      p_target_language: targetLanguage || null,
    });

    const result = data as { text?: string; error?: string } | null;
    if (!error && result && !result.error && result.text) {
      return result.text;
    }

    // DB proxy returned an error — log it and fall through to edge function
    const proxyError = error?.message || result?.error || 'Unknown DB proxy error';
    console.warn('DB proxy failed, trying edge function:', proxyError);
  } catch (e) {
    console.warn('DB proxy exception, trying edge function:', e);
  }

  // ── Fallback: edge function ──
  const body: Record<string, string> = { text, action };
  if (model) body.model = model;
  if (customPrompt) body.customPrompt = customPrompt;
  if (toneStyle) body.toneStyle = toneStyle;
  if (targetLanguage) body.targetLanguage = targetLanguage;

  const { data, error } = await supabase.functions.invoke('edit-transcript', { body });
  if (error) throw error;
  if (!data?.text) throw new Error('לא התקבלה תשובה מ-AI');
  return data.text;
}
