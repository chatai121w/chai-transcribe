import { recoverProviderKeysFromCloud } from "@/lib/cloudKeyFallback";
import { getEncryptedKey } from "@/lib/keyCrypto";

export type CloudTranscriptionProvider = "openai" | "groq" | "google" | "assemblyai" | "deepgram";

const singleKeyStorage: Record<CloudTranscriptionProvider, string> = {
  openai: "openai_api_key",
  groq: "groq_api_key",
  google: "google_api_key",
  assemblyai: "assemblyai_api_key",
  deepgram: "deepgram_api_key",
};

const poolStorage: Record<CloudTranscriptionProvider, string> = {
  openai: "openai_api_keys_pool",
  groq: "groq_api_keys_pool",
  google: "google_api_keys_pool",
  assemblyai: "assemblyai_api_keys_pool",
  deepgram: "deepgram_api_keys_pool",
};

const activeIndexStorage: Record<CloudTranscriptionProvider, string> = {
  openai: "openai_api_key_active_index",
  groq: "groq_api_key_active_index",
  google: "google_api_key_active_index",
  assemblyai: "assemblyai_api_key_active_index",
  deepgram: "deepgram_api_key_active_index",
};

export const transcriptionProviderLabel: Record<CloudTranscriptionProvider, string> = {
  openai: "OpenAI",
  groq: "Groq",
  google: "Google",
  assemblyai: "AssemblyAI",
  deepgram: "Deepgram",
};

export async function getProviderApiKeyPool(provider: CloudTranscriptionProvider): Promise<string[]> {
  const single = (await getEncryptedKey(singleKeyStorage[provider]))?.trim();
  const raw = localStorage.getItem(poolStorage[provider]);
  let pooled: string[] = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) pooled = parsed.map((key) => key.trim()).filter(Boolean);
    } catch { /* use the single encrypted key */ }
  }
  const local = Array.from(new Set(single && !pooled.includes(single) ? [single, ...pooled] : pooled));
  return local.length ? local : recoverProviderKeysFromCloud(provider);
}

export function shouldRotateProviderKey(error: unknown): boolean {
  const value = error as { message?: unknown; error?: unknown } | null;
  const message = String(value?.message || value?.error || "").toLowerCase();
  return ["rate_limit", "rate limit", "quota", "429", "invalid api key", "api key is invalid", "expired", "insufficient_quota", "unauthorized", "authentication"]
    .some((part) => message.includes(part));
}

export function getProviderStartIndex(provider: CloudTranscriptionProvider, poolLength: number): number {
  if (poolLength <= 0) return 0;
  const raw = Number.parseInt(localStorage.getItem(activeIndexStorage[provider]) || "0", 10);
  return Number.isFinite(raw) ? ((raw % poolLength) + poolLength) % poolLength : 0;
}

export function setProviderActiveKey(provider: CloudTranscriptionProvider, pool: string[], index: number): void {
  localStorage.setItem(activeIndexStorage[provider], String(index));
  localStorage.setItem(singleKeyStorage[provider], pool[index]);
}
