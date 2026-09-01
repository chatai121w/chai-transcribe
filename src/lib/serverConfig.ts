/**
 * Centralized server URL configuration.
 * All components should import from here instead of hardcoding localhost:3000.
 */

const DEFAULT_SERVER_URL = '/whisper';
const DEFAULT_REMOTE_SERVER_URL = 'http://localhost:3000';
const DISCOVERED_SERVER_URL_KEY = 'whisper_discovered_server_url';
const LOCAL_SERVER_ACCESS_SESSION_KEY = 'whisper_local_access_requested';

export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === '::1';
  } catch {
    return false;
  }
}

function getDiscoveredServerUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(DISCOVERED_SERVER_URL_KEY);
  return value && isLoopbackUrl(value) ? value.replace(/\/$/, '') : null;
}

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

  // Guard against garbage values accidentally saved into the server-URL field
  // (e.g. an email address synced from the cloud key store). A valid value must
  // be an absolute http(s) URL or a same-origin path starting with '/'.
  // Anything else (no scheme, no leading slash) → fall back to the default.
  const isValidShape = /^https?:\/\//i.test(v) || v.startsWith('/');
  if (!isValidShape) {
    return getDefaultUrl();
  }

  if (typeof window !== 'undefined') {
    const isLocalPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const isLegacy3000 = v.includes('localhost:3000') || v.includes('127.0.0.1:3000');
    if (isLocalPage && isLegacy3000) {
      return DEFAULT_SERVER_URL;
    }
    if (!isLocalPage && isLoopbackUrl(v)) {
      return getDiscoveredServerUrl() || v.replace(/\/$/, '');
    }
  }

  return v;
}

/** Return the correct default URL depending on whether we're on a local or deployed page. */
function getDefaultUrl(): string {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isLocalPage = host === 'localhost' || host === '127.0.0.1';
    if (!isLocalPage) return getDiscoveredServerUrl() || DEFAULT_REMOTE_SERVER_URL;
  }
  return DEFAULT_SERVER_URL;
}

/** Read the configured server URL from localStorage and normalize it. */
export function getServerUrl(): string {
  return normalizeServerUrl(localStorage.getItem('whisper_server_url'));
}

/** Keep machine-specific port discovery local; never sync it as a cloud API setting. */
export function setDiscoveredServerPort(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid local server port: ${port}`);
  }
  const url = `http://127.0.0.1:${port}`;
  localStorage.setItem(DISCOVERED_SERVER_URL_KEY, url);
  window.dispatchEvent(new CustomEvent('local-server-port-change', { detail: { port, url } }));
  return url;
}

type LoopbackRequestInit = RequestInit & { targetAddressSpace?: 'loopback' };

/**
 * Chrome 142+ requires an explicit Local Network Access grant for a public
 * HTTPS page to call software on localhost. Marking the destination as
 * loopback makes the browser show that permission prompt from a user action.
 */
export function fetchLocalServer(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const requestInit: LoopbackRequestInit = { ...init };
  if (isLoopbackUrl(raw)) requestInit.targetAddressSpace = 'loopback';
  return fetch(input, requestInit);
}

/**
 * Public HTTPS pages may only request loopback access after a user gesture.
 * Avoid noisy, guaranteed-to-fail health polls until the user clicks the
 * local-server control in this browser session.
 */
export function shouldAutoCheckLocalServer(
  serverUrl: string,
  hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost',
  accessRequested = typeof window !== 'undefined'
    ? sessionStorage.getItem(LOCAL_SERVER_ACCESS_SESSION_KEY) === '1'
    : false,
): boolean {
  const isLocalPage = hostname === 'localhost' || hostname === '127.0.0.1';
  return isLocalPage || !isLoopbackUrl(serverUrl) || accessRequested;
}

export function markLocalServerAccessRequested(requested: boolean): void {
  if (typeof window === 'undefined') return;
  if (requested) sessionStorage.setItem(LOCAL_SERVER_ACCESS_SESSION_KEY, '1');
  else sessionStorage.removeItem(LOCAL_SERVER_ACCESS_SESSION_KEY);
}

/** The default proxy path for local whisper server. */
export { DEFAULT_SERVER_URL };
