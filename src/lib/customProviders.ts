/**
 * Custom OpenAI-compatible providers manager.
 *
 * Lets the user add any OpenAI-compatible LLM endpoint:
 *   - Local servers: LM Studio, llama-server, vLLM, oobabooga
 *   - Direct cloud APIs: Groq, DeepSeek, xAI/Grok, Mistral, OpenRouter
 *
 * All providers expose `${baseUrl}/chat/completions` with Bearer auth.
 * Models for each provider are discovered via `${baseUrl}/models`.
 *
 * Storage:
 *   - localStorage `custom_providers_v1`        — provider metadata (no keys)
 *   - keyCrypto    `custom_provider_key_<id>`   — encrypted API key per provider
 */

import { getApiKey, setEncryptedKey, getEncryptedKey } from "./keyCrypto";

export interface CustomProvider {
  /** Stable id (used as model-value prefix) — e.g. "lmstudio", "groq", "user_abc123" */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** Base URL for OpenAI-compatible API (must end before /chat/completions) — e.g. "http://localhost:1234/v1" */
  baseUrl: string;
  /** Whether to require an API key on requests */
  requiresKey: boolean;
  /** Whether this provider is enabled (shown in dropdown) */
  enabled: boolean;
  /** Last-known model list (cached from /models discovery) */
  models?: { id: string; label?: string }[];
  /** Hint icon emoji for UI */
  icon?: string;
  /** Whether this is a built-in preset (cannot be deleted, only disabled) */
  builtin?: boolean;
  /** Notes shown to the user (e.g. "מהיר במיוחד · LPU") */
  description?: string;
}

const STORAGE_KEY = "custom_providers_v1";

/** Built-in preset providers — appear automatically in the manager. */
export const BUILTIN_PROVIDERS: CustomProvider[] = [
  {
    id: "lmstudio",
    name: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    requiresKey: false,
    enabled: false,
    icon: "🎨",
    builtin: true,
    description: "שרת מקומי עם GUI · תומך GGUF + MLX",
  },
  {
    id: "llamaserver",
    name: "llama.cpp server",
    baseUrl: "http://localhost:8080/v1",
    requiresKey: false,
    enabled: false,
    icon: "🦙",
    builtin: true,
    description: "שרת C++ ישיר · הכי מהיר ל-GGUF",
  },
  {
    id: "vllm",
    name: "vLLM",
    baseUrl: "http://localhost:8000/v1",
    requiresKey: false,
    enabled: false,
    icon: "⚡",
    builtin: true,
    description: "Throughput גבוה · מתאים ל-batch",
  },
  {
    id: "groq",
    name: "Groq Cloud",
    baseUrl: "https://api.groq.com/openai/v1",
    requiresKey: true,
    enabled: false,
    icon: "🚀",
    builtin: true,
    description: "מהירות LPU מטורפת · יש קבצי חינם",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    requiresKey: true,
    enabled: false,
    icon: "🐋",
    builtin: true,
    description: "DeepSeek-V3, R1 (reasoning) — זול ועמוק",
  },
  {
    id: "xai",
    name: "xAI Grok",
    baseUrl: "https://api.x.ai/v1",
    requiresKey: true,
    enabled: false,
    icon: "𝕏",
    builtin: true,
    description: "Grok-2, Grok-3 · מבית Elon Musk",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    baseUrl: "https://api.mistral.ai/v1",
    requiresKey: true,
    enabled: false,
    icon: "🌬️",
    builtin: true,
    description: "Mistral Large/Medium · רב-לשוני טוב",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    requiresKey: true,
    enabled: false,
    icon: "🌐",
    builtin: true,
    description: "מאות מודלים בספק אחד · pay-as-you-go",
  },
  {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    requiresKey: true,
    enabled: false,
    icon: "🤝",
    builtin: true,
    description: "מודלים open-source מהירים בענן",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    requiresKey: true,
    enabled: false,
    icon: "🧠",
    builtin: true,
    description: "מהירות מטורפת · יש שכבת חינם",
  },
];

/** Read all providers (built-ins merged with user-saved overrides + custom-added). */
export function getProviders(): CustomProvider[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const userProviders: CustomProvider[] = raw ? JSON.parse(raw) : [];
    // Merge: user overrides win for built-ins by id; user-only providers append
    const merged: CustomProvider[] = BUILTIN_PROVIDERS.map(b => {
      const override = userProviders.find(u => u.id === b.id);
      return override ? { ...b, ...override, builtin: true } : b;
    });
    for (const u of userProviders) {
      if (!BUILTIN_PROVIDERS.some(b => b.id === u.id)) merged.push({ ...u, builtin: false });
    }
    return merged;
  } catch {
    return [...BUILTIN_PROVIDERS];
  }
}

/** Persist user changes (overrides for built-ins + custom-added providers). */
export function saveProviders(providers: CustomProvider[]): void {
  // Only save what differs from built-ins (compact storage)
  const toSave = providers
    .filter(p => {
      const builtin = BUILTIN_PROVIDERS.find(b => b.id === p.id);
      if (!builtin) return true; // user-added
      // Save built-in only if overridden
      return (
        builtin.enabled !== p.enabled ||
        builtin.baseUrl !== p.baseUrl ||
        (p.models && p.models.length > 0)
      );
    })
    .map(p => ({ ...p, builtin: undefined })); // strip transient flag
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  window.dispatchEvent(new CustomEvent("custom-providers-changed"));
}

/** Get the API key for a provider (decrypted, in-memory cache). */
export function getProviderKey(providerId: string): string {
  // Special case: Groq reuses the existing 'groq_api_key' (set by main app for Whisper)
  if (providerId === "groq") {
    const existing = getApiKey("groq_api_key");
    if (existing) return existing;
  }
  return getApiKey(`custom_provider_key_${providerId}`);
}

/** Set the API key for a provider (encrypted). */
export async function setProviderKey(providerId: string, value: string): Promise<void> {
  await setEncryptedKey(`custom_provider_key_${providerId}`, value);
  window.dispatchEvent(new CustomEvent("custom-providers-changed"));
}

/** Decrypt and load the key into in-memory cache (call once at app start). */
export async function loadProviderKey(providerId: string): Promise<string> {
  return getEncryptedKey(`custom_provider_key_${providerId}`);
}

/**
 * Test connection to a provider — calls GET ${baseUrl}/models.
 * Returns the discovered models list, or throws on failure.
 */
export async function discoverProviderModels(
  provider: CustomProvider,
): Promise<{ id: string; label?: string }[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.requiresKey) {
    const key = getProviderKey(provider.id);
    if (!key) throw new Error("חסר מפתח API");
    headers.Authorization = `Bearer ${key}`;
  }
  const res = await fetch(`${provider.baseUrl}/models`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  // Standard OpenAI shape: { data: [{ id: "model-name" }, ...] }
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return list
    .filter((m: unknown): m is { id: string } => typeof m === "object" && m !== null && typeof (m as { id?: unknown }).id === "string")
    .map((m: { id: string }) => ({ id: m.id }));
}

/**
 * Send a chat completion request to a custom provider.
 * Returns the assistant's content as a string.
 */
export async function chatWithProvider(args: {
  providerId: string;
  modelId: string;
  systemPrompt: string;
  userText: string;
  temperature?: number;
}): Promise<string> {
  const provider = getProviders().find(p => p.id === args.providerId);
  if (!provider) throw new Error(`ספק לא ידוע: ${args.providerId}`);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.requiresKey) {
    const key = getProviderKey(provider.id);
    if (!key) throw new Error(`חסר מפתח API ל-${provider.name}`);
    headers.Authorization = `Bearer ${key}`;
  }
  // OpenRouter requires a Referer/HTTP-Referer header
  if (provider.id === "openrouter") {
    headers["HTTP-Referer"] = window.location.origin;
    headers["X-Title"] = "Smart Hebrew Transcriber";
  }
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: args.modelId,
      messages: [
        { role: "system", content: args.systemPrompt },
        { role: "user", content: args.userText },
      ],
      temperature: args.temperature ?? 0.7,
      stream: false,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`${provider.name}: HTTP ${res.status} — ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content) {
    throw new Error(`${provider.name}: תשובה ריקה מהמודל`);
  }
  return content;
}

/** Encode a model from a custom provider as a single string (used as Select value). */
export function encodeProviderModel(providerId: string, modelId: string): string {
  return `provider:${providerId}:${modelId}`;
}

/** Parse "provider:<id>:<model>" → { providerId, modelId } or null. */
export function parseProviderModel(value: string): { providerId: string; modelId: string } | null {
  if (!value.startsWith("provider:")) return null;
  const rest = value.slice("provider:".length);
  const idx = rest.indexOf(":");
  if (idx < 0) return null;
  return { providerId: rest.slice(0, idx), modelId: rest.slice(idx + 1) };
}

/** Subscribe to provider list changes (for live UI updates). */
export function subscribeProviders(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener("custom-providers-changed", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("custom-providers-changed", handler);
    window.removeEventListener("storage", handler);
  };
}
