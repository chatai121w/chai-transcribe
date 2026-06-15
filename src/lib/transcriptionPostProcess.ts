/**
 * Transcription post-processing pipeline.
 *
 * Runs after any transcription completes (upload, recording, or live mode)
 * and applies a sequence of optional steps based on feature flags.
 *
 * Steps (in order):
 *   1. Hebrew names dictionary    — ff_names_dictionary
 *   2. AI final correction (Gemini) — ff_ai_post_correction
 *
 * Each step is independent and safe to skip on failure.
 */

import { supabase } from "@/integrations/supabase/client";
import { readFlag } from "@/lib/featureFlags";
import { applyNamesDictionary } from "@/lib/hebrewNamesDictionary";
import { debugLog } from "@/lib/debugLogger";

export interface PostProcessResult {
  text: string;
  changed: boolean;
  steps: Array<{ name: string; applied: boolean; note?: string }>;
}

export async function runPostProcessingPipeline(
  input: string,
  opts: { signal?: AbortSignal } = {},
): Promise<PostProcessResult> {
  const steps: PostProcessResult["steps"] = [];
  let text = input;
  const original = input;

  if (!text || !text.trim()) {
    return { text, changed: false, steps };
  }

  // ── 1. Hebrew names dictionary ─────────────────────────────
  if (readFlag("ff_names_dictionary")) {
    try {
      const { text: next, replacements } = applyNamesDictionary(text);
      text = next;
      steps.push({
        name: "names_dictionary",
        applied: replacements > 0,
        note: replacements > 0 ? `${replacements} שמות הוחלפו` : "ללא התאמות",
      });
    } catch (err) {
      steps.push({ name: "names_dictionary", applied: false, note: String(err) });
    }
  }

  // ── 2. AI final correction ─────────────────────────────────
  if (readFlag("ff_ai_post_correction")) {
    try {
      if (opts.signal?.aborted) throw new Error("aborted");
      const { data, error } = await supabase.rpc("edit_transcript_proxy", {
        p_text: text,
        p_action: "fix_errors",
        p_model: "gemini-2.5-flash",
      });
      if (error) throw error;
      const result = data as { text?: string; error?: string } | null;
      if (result?.error) throw new Error(result.error);
      if (result?.text && result.text.trim()) {
        text = result.text;
        steps.push({ name: "ai_post_correction", applied: true });
      } else {
        steps.push({ name: "ai_post_correction", applied: false, note: "ללא טקסט בתגובה" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog.warn("PostProcess", "AI post-correction failed", msg);
      steps.push({ name: "ai_post_correction", applied: false, note: msg });
    }
  }

  return { text, changed: text !== original, steps };
}

/**
 * Returns audio constraints for getUserMedia based on current flags.
 * Pass spreadable into `audio: { ... }`.
 */
export function getAudioConstraintOverrides(): MediaTrackConstraints {
  const agcEnabled = readFlag("ff_agc_auto");
  return {
    autoGainControl: agcEnabled,
  };
}
