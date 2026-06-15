/**
 * Client API for the server-side harmony engine.
 * Calls POST /harmonize on the Whisper server (via Vite proxy at /whisper).
 */

import { getServerUrl } from "@/lib/serverConfig";
import type { Voice, ScaleName, RootNote } from "@/lib/harmony-engine";

export type HarmonyQuality = "browser" | "basic" | "pro" | "studio";

export interface HarmonyCapabilities {
  tiers: Record<string, { available: boolean; label: string; label_en: string }>;
}

export interface ServerHarmonyOptions {
  file: File;
  voices: Voice[];
  scale: ScaleName;
  root: RootNote;
  dryGain: number;
  wetGain: number;
  quality: Exclude<HarmonyQuality, "browser">;
  maxDuration?: number;
}

/** Check which server-side harmony tiers are available. */
export async function fetchHarmonyCapabilities(): Promise<HarmonyCapabilities | null> {
  try {
    const url = getServerUrl();
    const res = await fetch(`${url}/harmonize/capabilities`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Send audio to server for harmony processing. Returns a WAV Blob. */
export async function renderHarmonyServer(opts: ServerHarmonyOptions): Promise<Blob> {
  const url = getServerUrl();
  const form = new FormData();
  form.append("audio", opts.file);
  form.append("voices", JSON.stringify(opts.voices));
  form.append("scale", opts.scale);
  form.append("root", opts.root);
  form.append("dryGain", String(opts.dryGain));
  form.append("wetGain", String(opts.wetGain));
  form.append("quality", opts.quality);
  if (opts.maxDuration != null) {
    form.append("maxDuration", String(opts.maxDuration));
  }

  const res = await fetch(`${url}/harmonize`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    throw new Error(err.error || `Server error ${res.status}`);
  }

  return res.blob();
}
