/**
 * Centralized server URL configuration.
 * All components should import from here instead of hardcoding localhost:3000.
 */

const DEFAULT_SERVER_URL = '/whisper';
const DEFAULT_REMOTE_SERVER_URL = 'http://localhost:3000';

/**
 * Normalize a raw server URL value from localStorage.
 * Converts legacy localhost:3000 references to the Vite proxy path when running locally.
 * On deployed (non-localhost) sites, defaults to http://localhost:3000 for CUDA server.
 */
export function normalizeServerUrl(raw: string | null | undefined): string {
  const v = (raw || '').trim();

  // Skip encrypted values — treat as empty
  if (v.startsWith('enc:')) {
    return getDefaultUrl();
  }

  if (!v) return getDefaultUrl();

  if (typeof window !== 'undefined') {
    const isLocalPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const isLegacy3000 = v.includes('localhost:3000') || v.includes('127.0.0.1:3000');
    if (isLocalPage && isLegacy3000) {
      return DEFAULT_SERVER_URL;
    }
  }

  return v;
}

/** Return the correct default URL depending on whether we're on a local or deployed page. */
function getDefaultUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalPage = host === 'localhost' || host === '127.0.0.1';
    if (!isLocalPage) return DEFAULT_REMOTE_SERVER_URL;
  }
  return DEFAULT_SERVER_URL;
}

/** Read the configured server URL from localStorage and normalize it. */
export function getServerUrl(): string {
  return normalizeServerUrl(localStorage.getItem('whisper_server_url'));
}

/** The default proxy path for local whisper server. */
export { DEFAULT_SERVER_URL };
