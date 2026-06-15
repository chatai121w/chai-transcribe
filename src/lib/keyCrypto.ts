/**
 * Encrypt/decrypt API keys in localStorage using AES-GCM via Web Crypto API.
 * Key is derived from a per-session random key stored in sessionStorage,
 * so keys are only accessible during the active browser session.
 *
 * Also maintains an in-memory cache so synchronous reads work.
 */

const ALGO = 'AES-GCM';
const SESSION_KEY_NAME = '__sht_sk';
const ENCRYPTED_PREFIX = 'enc:';

// In-memory plaintext cache — populated by setEncryptedKey / initKeyCache
const _memCache = new Map<string, string>();

/** Get or create a per-session encryption key. */
async function getSessionKey(): Promise<CryptoKey> {
  let raw = sessionStorage.getItem(SESSION_KEY_NAME);
  if (!raw) {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    raw = btoa(String.fromCharCode(...keyBytes));
    sessionStorage.setItem(SESSION_KEY_NAME, raw);
  }
  const keyData = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', keyData, ALGO, false, ['encrypt', 'decrypt']);
}

/** Encrypt a plaintext string. Returns "enc:<base64(iv+ciphertext)>". */
export async function encryptValue(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  const key = await getSessionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return ENCRYPTED_PREFIX + btoa(String.fromCharCode(...combined));
}

/** Decrypt an encrypted value. Handles both encrypted and legacy plaintext values. */
export async function decryptValue(stored: string): Promise<string> {
  if (!stored) return '';
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    return stored; // Legacy plaintext
  }
  try {
    const key = await getSessionKey();
    const combined = Uint8Array.from(atob(stored.slice(ENCRYPTED_PREFIX.length)), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const plainBuffer = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
    return new TextDecoder().decode(plainBuffer);
  } catch {
    return '';
  }
}

/** Store an API key in localStorage with encryption + update in-memory cache. */
export async function setEncryptedKey(storageKey: string, value: string): Promise<void> {
  if (!value) {
    localStorage.removeItem(storageKey);
    _memCache.delete(storageKey);
    return;
  }
  _memCache.set(storageKey, value);
  const encrypted = await encryptValue(value);
  localStorage.setItem(storageKey, encrypted);
}

/**
 * Synchronous read — returns from in-memory cache first, falls back to raw localStorage.
 * Works for both encrypted and legacy plaintext values.
 */
export function getApiKey(storageKey: string): string {
  // In-memory cache has plaintext
  const cached = _memCache.get(storageKey);
  if (cached) return cached;

  // Fallback to localStorage (works for legacy plaintext only)
  const stored = localStorage.getItem(storageKey);
  if (!stored) return '';
  if (stored.startsWith(ENCRYPTED_PREFIX)) return ''; // encrypted, not yet decrypted
  return stored;
}

/** Read an API key from localStorage, decrypting if needed (async). */
export async function getEncryptedKey(storageKey: string): Promise<string> {
  const cached = _memCache.get(storageKey);
  if (cached) return cached;
  const stored = localStorage.getItem(storageKey);
  if (!stored) return '';
  const plaintext = await decryptValue(stored);
  if (plaintext) _memCache.set(storageKey, plaintext);
  return plaintext;
}
