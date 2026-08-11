export const TRANSCRIPTION_LANGUAGES = [
  { code: "he", label: "עברית", nativeLabel: "עברית", bcp47: "he-IL" },
  { code: "yi", label: "יידיש", nativeLabel: "יידיש", bcp47: "yi" },
  { code: "en", label: "אנגלית", nativeLabel: "English", bcp47: "en-US" },
  { code: "fr", label: "צרפתית", nativeLabel: "Français", bcp47: "fr-FR" },
  { code: "ar", label: "ערבית", nativeLabel: "العربية", bcp47: "ar" },
  { code: "es", label: "ספרדית", nativeLabel: "Español", bcp47: "es-ES" },
  { code: "de", label: "גרמנית", nativeLabel: "Deutsch", bcp47: "de-DE" },
  { code: "it", label: "איטלקית", nativeLabel: "Italiano", bcp47: "it-IT" },
  { code: "pt", label: "פורטוגזית", nativeLabel: "Português", bcp47: "pt-PT" },
  { code: "ru", label: "רוסית", nativeLabel: "Русский", bcp47: "ru-RU" },
  { code: "uk", label: "אוקראינית", nativeLabel: "Українська", bcp47: "uk-UA" },
  { code: "pl", label: "פולנית", nativeLabel: "Polski", bcp47: "pl-PL" },
  { code: "nl", label: "הולנדית", nativeLabel: "Nederlands", bcp47: "nl-NL" },
  { code: "tr", label: "טורקית", nativeLabel: "Türkçe", bcp47: "tr-TR" },
] as const;

export type ManualTranscriptionLanguage = typeof TRANSCRIPTION_LANGUAGES[number]["code"];
export type SourceLanguage = "auto" | ManualTranscriptionLanguage;

export const DEFAULT_MULTILINGUAL_CUDA_MODEL = "large-v3-turbo";

export function isSourceLanguage(value: unknown): value is SourceLanguage {
  return value === "auto" || TRANSCRIPTION_LANGUAGES.some(({ code }) => code === value);
}

export function normalizeSourceLanguage(value: unknown): SourceLanguage {
  return isSourceLanguage(value) ? value : "auto";
}

export function getLanguageLabel(language: SourceLanguage): string {
  if (language === "auto") return "זיהוי אוטומטי";
  return TRANSCRIPTION_LANGUAGES.find(({ code }) => code === language)?.label || language;
}

export function getBrowserLanguage(language: SourceLanguage): string {
  if (language === "auto") return "";
  return TRANSCRIPTION_LANGUAGES.find(({ code }) => code === language)?.bcp47 || language;
}

export function isHebrewOptimizedModel(model?: string | null): boolean {
  if (!model) return false;
  return model.startsWith("lora:") || (
    model.startsWith("ivrit-ai/") && !model.includes("/yi-")
  );
}

export function isYiddishOptimizedModel(model?: string | null): boolean {
  return !!model && model.startsWith("ivrit-ai/yi-");
}

/**
 * Automatic detection and non-Hebrew transcription must use a multilingual
 * model. A stale Hebrew/LoRA preference would otherwise bias or corrupt it.
 */
export function resolveCudaModel(
  language: SourceLanguage,
  preferredModel?: string | null,
): string | undefined {
  if (language === "he") return preferredModel || undefined;
  if (language === "yi" && isYiddishOptimizedModel(preferredModel)) return preferredModel || undefined;
  if (preferredModel && !isHebrewOptimizedModel(preferredModel) && !isYiddishOptimizedModel(preferredModel)) {
    return preferredModel;
  }
  return DEFAULT_MULTILINGUAL_CUDA_MODEL;
}

export function shouldUseHebrewKnowledge(
  requestedLanguage: SourceLanguage,
  detectedLanguage?: string | null,
): boolean {
  if (requestedLanguage === "he") return true;
  if (requestedLanguage !== "auto") return false;
  return detectedLanguage === "he";
}
