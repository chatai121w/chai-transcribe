import { getServerUrl } from "@/lib/serverConfig";
import { getApiKey } from "@/lib/keyCrypto";

export type EnhancementPreset = "clean" | "ai_voice" | "podcast" | "broadcast" | "ai_denoise" | "ai_enhance" | "ai_full" | "ai_hebrew";
export type EnhancementOutputFormat = "mp3" | "opus" | "aac";

export interface AiEnhanceStatus {
  available: boolean;
  engines: { spectral?: boolean; metricgan?: boolean; gpu?: boolean; gpu_name?: string };
  presets: Array<{ id: string; label: string; description: string; ai: boolean }>;
  error?: string;
}

export async function fetchAiEnhanceStatus(): Promise<AiEnhanceStatus> {
  try {
    const serverUrl = getServerUrl();
    const res = await fetch(`${serverUrl}/ai-enhance-status`, { headers: getApiHeaders() });
    if (!res.ok) return { available: false, engines: {}, presets: [] };
    return await res.json();
  } catch {
    return { available: false, engines: {}, presets: [] };
  }
}

export interface EnhanceAudioOptions {
  preset: EnhancementPreset;
  outputFormat: EnhancementOutputFormat;
  signal?: AbortSignal;
}

export interface EnhanceAudioResult {
  blob: Blob;
  fileName: string;
  mimeType: string;
}

export interface EnhancementRecommendationRow {
  preset: EnhancementPreset;
  wordCount: number;
  avgProbability: number;
  processingTimeSec: number;
  score: number;
}

export interface EnhancementRecommendation {
  bestPreset: EnhancementPreset;
  rows: EnhancementRecommendationRow[];
  baseline: {
    wordCount: number;
    avgProbability: number;
    processingTimeSec: number;
  };
  rationale: string;
}

function parseFileNameFromContentDisposition(cd: string | null, fallback: string): string {
  if (!cd) return fallback;
  const m = cd.match(/filename\*?=(?:UTF-8''|\")?([^;\"\n]+)/i);
  if (!m || !m[1]) return fallback;
  try {
    return decodeURIComponent(m[1].replace(/\"/g, "").trim());
  } catch {
    return m[1].replace(/\"/g, "").trim();
  }
}

function getFallbackName(inputName: string, outputFormat: EnhancementOutputFormat): string {
  const ext = outputFormat === "aac" ? "m4a" : outputFormat;
  return inputName.replace(/\.[^/.]+$/, "") + `.enhanced.${ext}`;
}

function getApiHeaders(): Record<string, string> {
  const key = getApiKey("whisper_api_key");
  return key ? { "X-API-Key": key } : {};
}

async function transcribeForQuality(file: File, language: "he" | "auto" = "he") {
  const serverUrl = getServerUrl();
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("language", language);
  form.append("preset", "balanced");

  const started = performance.now();
  const res = await fetch(`${serverUrl}/transcribe`, {
    method: "POST",
    headers: getApiHeaders(),
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `Transcription failed (${res.status})`);
  }

  const data = await res.json();
  const text = String(data.text || "");
  const wordTimings = Array.isArray(data.wordTimings) ? data.wordTimings : [];
  const avgProbability = wordTimings.length > 0
    ? wordTimings.reduce((sum: number, w: any) => sum + (Number(w?.probability) || 0), 0) / wordTimings.length
    : 0;

  return {
    wordCount: text.split(/\s+/).filter(Boolean).length,
    avgProbability,
    processingTimeSec: Number(data.processing_time) || (performance.now() - started) / 1000,
  };
}

function scoreRow(
  baseline: { wordCount: number; avgProbability: number; processingTimeSec: number },
  row: { wordCount: number; avgProbability: number; processingTimeSec: number },
): number {
  // Emphasize confidence and completeness for transcription readability.
  const wordDeltaPct = ((row.wordCount - baseline.wordCount) / Math.max(1, baseline.wordCount)) * 100;
  const confDeltaPct = (row.avgProbability - baseline.avgProbability) * 100;
  const speedDeltaPct = ((baseline.processingTimeSec - row.processingTimeSec) / Math.max(0.001, baseline.processingTimeSec)) * 100;
  return (0.25 * wordDeltaPct) + (0.65 * confDeltaPct) + (0.10 * speedDeltaPct);
}

export async function recommendEnhancementForTranscription(
  file: File,
  options?: {
    language?: "he" | "auto";
    outputFormat?: EnhancementOutputFormat;
    presets?: EnhancementPreset[];
  },
): Promise<EnhancementRecommendation> {
  const language = options?.language || "he";
  const outputFormat = options?.outputFormat || "mp3";
  const presets = options?.presets?.length
    ? options.presets
    : (["ai_hebrew", "ai_full", "ai_enhance", "ai_denoise", "ai_voice", "clean", "podcast", "broadcast"] as EnhancementPreset[]);

  const baseline = await transcribeForQuality(file, language);

  const rows: EnhancementRecommendationRow[] = [];
  for (const preset of presets) {
    const enhanced = await enhanceAudioOnServer(file, { preset, outputFormat });
    const enhancedFile = new File([enhanced.blob], enhanced.fileName, { type: enhanced.mimeType });
    const t = await transcribeForQuality(enhancedFile, language);
    rows.push({
      preset,
      wordCount: t.wordCount,
      avgProbability: t.avgProbability,
      processingTimeSec: t.processingTimeSec,
      score: scoreRow(baseline, t),
    });
  }

  rows.sort((a, b) => b.score - a.score);
  const winner = rows[0];
  const rationale = `המלצה: ${winner.preset.toUpperCase()} (שיפור ביטחון ממוצע ומבנה טקסט ביחס למקור). ציון: ${winner.score.toFixed(2)}`;

  return {
    bestPreset: winner.preset,
    rows,
    baseline,
    rationale,
  };
}

export async function enhanceAudioOnServer(file: File, options: EnhanceAudioOptions): Promise<EnhanceAudioResult> {
  const serverUrl = getServerUrl();
  const formData = new FormData();
  formData.append("file", file);
  formData.append("preset", options.preset);
  formData.append("output_format", options.outputFormat);

  const res = await fetch(`${serverUrl}/enhance-audio`, {
    method: "POST",
    headers: getApiHeaders(),
    body: formData,
    signal: options.signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Server enhancement failed" }));
    throw new Error(body.error || `Enhancement failed (${res.status})`);
  }

  const blob = await res.blob();
  const mimeType = res.headers.get("content-type") || blob.type || "application/octet-stream";
  const fileName = parseFileNameFromContentDisposition(
    res.headers.get("content-disposition"),
    getFallbackName(file.name, options.outputFormat),
  );

  return { blob, fileName, mimeType };
}
