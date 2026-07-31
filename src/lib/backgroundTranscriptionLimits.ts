const MB = 1024 * 1024;

export const BACKGROUND_STORAGE_LIMIT_BYTES = 50 * MB;

const ENGINE_LIMITS: Record<string, number> = {
  groq: 24 * MB,
  openai: 24 * MB,
  google: 9 * MB,
  deepgram: BACKGROUND_STORAGE_LIMIT_BYTES,
  assemblyai: BACKGROUND_STORAGE_LIMIT_BYTES,
};

export interface BackgroundFileValidation {
  valid: boolean;
  maxBytes: number;
  message?: string;
}

export function getBackgroundEngineLimit(engine: string): number {
  return Math.min(
    ENGINE_LIMITS[engine] ?? BACKGROUND_STORAGE_LIMIT_BYTES,
    BACKGROUND_STORAGE_LIMIT_BYTES,
  );
}

export function validateBackgroundTranscriptionFile(
  file: Pick<File, "size">,
  engine: string,
): BackgroundFileValidation {
  const maxBytes = getBackgroundEngineLimit(engine);
  if (file.size <= maxBytes) return { valid: true, maxBytes };

  const actualMb = (file.size / MB).toFixed(1);
  const limitMb = Math.floor(maxBytes / MB);
  const engineName = engine === "assemblyai" ? "AssemblyAI" :
    engine === "deepgram" ? "Deepgram" :
    engine === "openai" ? "OpenAI" :
    engine === "groq" ? "Groq" :
    engine === "google" ? "Google" : engine;

  return {
    valid: false,
    maxBytes,
    message: `הקובץ בגודל ${actualMb}MB, מעל מגבלת ${limitMb}MB של ${engineName}. יש להמיר ל-Opus באיכות "מומלץ לתמלול", לבחור Deepgram/AssemblyAI, או להשתמש בשרת CUDA המקומי.`,
  };
}
