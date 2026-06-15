/**
 * useKeyRotation — shared API key pool + rotation logic for cloud transcription engines.
 */

import { useCallback } from "react";
import { getApiKey } from "@/lib/keyCrypto";

function getApiKeyPool(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k: unknown) => typeof k === 'string' && k.trim()) : [];
  } catch { return []; }
}

export type CloudProvider = 'openai' | 'groq' | 'google' | 'assemblyai' | 'deepgram';

const PROVIDER_SINGLE_KEY: Record<CloudProvider, string> = {
  openai: 'openai_api_key',
  groq: 'groq_api_key',
  google: 'google_api_key',
  assemblyai: 'assemblyai_api_key',
  deepgram: 'deepgram_api_key',
};

const PROVIDER_POOL_KEY: Record<CloudProvider, string> = {
  openai: 'openai_api_keys_pool',
  groq: 'groq_api_keys_pool',
  google: 'google_api_keys_pool',
  assemblyai: 'assemblyai_api_keys_pool',
  deepgram: 'deepgram_api_keys_pool',
};

const PROVIDER_INDEX_KEY: Record<CloudProvider, string> = {
  openai: 'openai_api_key_active_index',
  groq: 'groq_api_key_active_index',
  google: 'google_api_key_active_index',
  assemblyai: 'assemblyai_api_key_active_index',
  deepgram: 'deepgram_api_key_active_index',
};

const PROVIDER_LABEL: Record<CloudProvider, string> = {
  openai: 'OpenAI',
  groq: 'Groq',
  google: 'Google',
  assemblyai: 'AssemblyAI',
  deepgram: 'Deepgram',
};

export function useKeyRotation() {
  const getPool = useCallback((provider: CloudProvider): string[] => {
    const single = getApiKey(PROVIDER_SINGLE_KEY[provider])?.trim();
    const pooled = getApiKeyPool(PROVIDER_POOL_KEY[provider]);
    const merged = [...pooled];
    if (single && !merged.includes(single)) {
      merged.unshift(single);
    }
    return Array.from(new Set(merged));
  }, []);

  const shouldRotate = useCallback((err: any): boolean => {
    const msg = String(err?.message || err?.error || '').toLowerCase();
    return (
      msg.includes('rate_limit') ||
      msg.includes('rate limit') ||
      msg.includes('quota') ||
      msg.includes('429') ||
      msg.includes('invalid api key') ||
      msg.includes('api key is invalid') ||
      msg.includes('expired') ||
      msg.includes('insufficient_quota') ||
      msg.includes('unauthorized') ||
      msg.includes('authentication')
    );
  }, []);

  const getStartIndex = useCallback((provider: CloudProvider, poolLength: number): number => {
    if (poolLength <= 0) return 0;
    const raw = parseInt(localStorage.getItem(PROVIDER_INDEX_KEY[provider]) || '0', 10);
    if (!Number.isFinite(raw)) return 0;
    return ((raw % poolLength) + poolLength) % poolLength;
  }, []);

  const setActiveKey = useCallback((provider: CloudProvider, pool: string[], index: number) => {
    localStorage.setItem(PROVIDER_INDEX_KEY[provider], String(index));
    localStorage.setItem(PROVIDER_SINGLE_KEY[provider], pool[index]);
  }, []);

  const getLabel = useCallback((provider: CloudProvider): string => {
    return PROVIDER_LABEL[provider];
  }, []);

  return { getPool, shouldRotate, getStartIndex, setActiveKey, getLabel };
}
