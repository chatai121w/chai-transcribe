import { supabase } from "@/integrations/supabase/client";
import { extractAudioSegments } from "@/lib/audioSegment";
import { getPersonalGeminiKey, getPersonalGeminiModel } from "@/lib/personalGemini";
import {
  getProviderApiKeyPool,
  getProviderStartIndex,
  setProviderActiveKey,
  shouldRotateProviderKey,
  transcriptionProviderLabel,
  type CloudTranscriptionProvider,
} from "@/lib/providerApiKeys";

export type TranscriptionEngineId = CloudTranscriptionProvider | "gemini" | "local-server" | "local";

export interface RetranscriptionWordTiming {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface RetranscriptionResult {
  text: string;
  wordTimings: RetranscriptionWordTiming[];
  engine: TranscriptionEngineId;
  engineLabel: string;
  detectedLanguage?: string;
  model?: string;
}

interface RunCloudOptions {
  engine: CloudTranscriptionProvider | "gemini";
  file: File;
  language: string;
  model?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number, status?: string) => void;
  onPartial?: (text: string, progress: number) => void;
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = reader.result?.toString().split(",")[1];
      value ? resolve(value) : reject(new Error("לא ניתן לקרוא את קובץ האודיו"));
    };
    reader.onerror = () => reject(reader.error || new Error("לא ניתן לקרוא את קובץ האודיו"));
    reader.readAsDataURL(file);
  });
}

function invokeMultipart(
  functionName: string,
  formData: FormData,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`);
    const token = supabase.auth.getSession().then(({ data }) => {
      const accessToken = data.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
      if (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 45));
      };
      xhr.onload = () => {
        let body: Record<string, any> = {};
        try { body = JSON.parse(xhr.responseText || "{}"); } catch { /* handled below */ }
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          resolve(body);
        } else {
          reject(Object.assign(new Error(body.error || body.message || `HTTP ${xhr.status}`), { status: xhr.status, ...body }));
        }
      };
      xhr.onerror = () => reject(new Error("שגיאת רשת בזמן התמלול"));
      xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
      signal?.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(formData);
    });
    token.catch(reject);
  });
}

async function runGemini(options: RunCloudOptions): Promise<RetranscriptionResult> {
  const personalKey = getPersonalGeminiKey();
  const model = (options.model || localStorage.getItem("gemini_transcription_model") || getPersonalGeminiModel() || "gemini-2.5-flash").replace(/^google\//, "");
  const { segments } = await extractAudioSegments(options.file, 8 * 60);
  const completed: string[] = [];
  let provider = personalKey ? "personal" : "lovable";

  for (let index = 0; index < segments.length; index++) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const segment = segments[index];
    const form = new FormData();
    form.append("file", segment.file, segment.file.name);
    form.append("model", model);
    form.append("language", options.language);
    if (personalKey) form.append("apiKey", personalKey);
    const data = await invokeMultipart("transcribe-gemini", form, options.signal, (uploadProgress) => {
      options.onProgress?.(Math.min(99, Math.round(((index + uploadProgress / 100) / segments.length) * 100)), `Gemini: מקטע ${index + 1} מתוך ${segments.length}`);
    });
    if (!data.text) throw new Error(`לא התקבל תמלול מ-Gemini למקטע ${index + 1}`);
    completed.push(String(data.text).trim());
    provider = data.provider || provider;
    const progress = Math.round(((index + 1) / segments.length) * 100);
    options.onPartial?.(completed.join("\n\n"), progress);
  }

  const text = completed.join("\n\n").trim();
  if (!text) throw new Error("לא התקבל תמלול מ-Gemini");
  return { text, wordTimings: [], engine: "gemini", engineLabel: `Gemini (${model}, ${provider === "personal" ? "מפתח אישי" : "Lovable AI"})`, model };
}

export async function runCloudRetranscription(options: RunCloudOptions): Promise<RetranscriptionResult> {
  if (options.engine === "gemini") return runGemini(options);
  const provider = options.engine;
  const keys = await getProviderApiKeyPool(provider);
  if (!keys.length) throw new Error(`לא הוגדר מפתח API עבור ${transcriptionProviderLabel[provider]}`);
  const start = getProviderStartIndex(provider, keys.length);
  let lastError: unknown;

  for (let offset = 0; offset < keys.length; offset++) {
    const index = (start + offset) % keys.length;
    try {
      let data: Record<string, any>;
      if (provider === "google") {
        options.onProgress?.(5, "קורא את קובץ האודיו");
        const audio = await readFileBase64(options.file);
        options.onProgress?.(35, "שולח ל-Google Speech-to-Text");
        const response = await supabase.functions.invoke("transcribe-google", {
          body: { audio, fileName: options.file.name, apiKey: keys[index], language: options.language },
        });
        if (response.error) throw response.error;
        data = response.data || {};
        options.onProgress?.(100);
      } else {
        const form = new FormData();
        form.append("file", options.file, options.file.name);
        form.append("fileName", options.file.name);
        form.append("apiKey", keys[index]);
        form.append("language", options.language);
        data = await invokeMultipart(`transcribe-${provider}`, form, options.signal, (progress) => options.onProgress?.(progress, `מתמלל באמצעות ${transcriptionProviderLabel[provider]}`));
      }
      if (!data.text) throw new Error("לא התקבל תמלול מהמנוע");
      setProviderActiveKey(provider, keys, index);
      return {
        text: String(data.text),
        wordTimings: (data.wordTimings || data.word_timings || []) as RetranscriptionWordTiming[],
        engine: provider,
        engineLabel: transcriptionProviderLabel[provider],
        detectedLanguage: data.language || data.detectedLanguage,
        model: data.model,
      };
    } catch (error) {
      lastError = error;
      if (!shouldRotateProviderKey(error) || offset === keys.length - 1) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("התמלול נכשל");
}

export const TRANSCRIPTION_ENGINE_OPTIONS: Array<{ id: TranscriptionEngineId; label: string; detail: string }> = [
  { id: "local-server", label: "CUDA מקומי", detail: "Whisper על כרטיס המסך" },
  { id: "groq", label: "Groq", detail: "Whisper מהיר בענן" },
  { id: "gemini", label: "Gemini", detail: "Google AI עם מעבר אוטומטי ל-Lovable" },
  { id: "openai", label: "OpenAI", detail: "Whisper-1" },
  { id: "google", label: "Google", detail: "Speech-to-Text" },
  { id: "assemblyai", label: "AssemblyAI", detail: "Universal" },
  { id: "deepgram", label: "Deepgram", detail: "Nova" },
  { id: "local", label: "מקומי בדפדפן", detail: "WebGPU או WASM" },
];
