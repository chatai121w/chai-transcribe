import { fetchLocalServer, getServerUrl, isLoopbackUrl, setDiscoveredServerPort } from '@/lib/serverConfig';

const LAUNCHER_PORT_KEY = 'local_launcher_port';
const DEFAULT_LAUNCHER_PORT = 8764;
const LAUNCHER_SCAN_COUNT = 10;

export interface LocalServerStartResult {
  ok: boolean;
  message: string;
  port: number;
  serverUrl: string;
  launcherPort?: number;
}

export interface LocalOllamaStartResult {
  ok: boolean;
  message: string;
  launcherPort?: number;
}

function isLocalFrontend(): boolean {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

async function readJson(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(response.url.includes('/__api/')
      ? 'נתיב ההפעלה המקומי אינו זמין בפריסה זו'
      : 'שירות ההפעלה המקומי החזיר תשובה לא תקינה');
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('שירות ההפעלה המקומי החזיר JSON פגום');
  }
}

function launcherPorts(): number[] {
  const saved = Number(localStorage.getItem(LAUNCHER_PORT_KEY));
  const defaults = Array.from({ length: LAUNCHER_SCAN_COUNT }, (_, index) => DEFAULT_LAUNCHER_PORT + index);
  return Number.isInteger(saved) && saved >= DEFAULT_LAUNCHER_PORT && saved < DEFAULT_LAUNCHER_PORT + LAUNCHER_SCAN_COUNT
    ? [saved, ...defaults.filter((port) => port !== saved)]
    : defaults;
}

function normalizeResult(data: any, launcherPort?: number): LocalServerStartResult {
  const whisper = data?.results?.whisper;
  const port = Number(data?.port ?? whisper?.port ?? data?.whisper?.port);
  if (!data?.ok || !Number.isInteger(port)) {
    throw new Error(whisper?.message || data?.error || 'שירות ההפעלה לא החזיר פורט שרת תקין');
  }
  const serverUrl = setDiscoveredServerPort(port);
  if (launcherPort) localStorage.setItem(LAUNCHER_PORT_KEY, String(launcherPort));
  return {
    ok: true,
    message: whisper?.message || data.message || 'starting',
    port,
    serverUrl,
    launcherPort,
  };
}

async function startViaVite(): Promise<LocalServerStartResult> {
  const response = await fetch('/__api/start-server', { method: 'POST' });
  const data = await readJson(response);
  return normalizeResult(data);
}

async function startViaLauncher(): Promise<LocalServerStartResult> {
  const tryPort = async (port: number, timeout: number) => {
    try {
      const response = await fetchLocalServer(`http://127.0.0.1:${port}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ target: 'whisper' }),
        signal: AbortSignal.timeout(timeout),
      });
      if (!response.ok) return { result: null, error: `HTTP ${response.status}` };
      return { result: normalizeResult(await readJson(response), port), error: '' };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : String(error) };
    }
  };

  const ports = launcherPorts();
  const preferred = await tryPort(ports[0], 5000);
  if (preferred.result) return preferred.result;

  // Only one launcher can own the mutex. Probe fallback ports concurrently so
  // a missing launcher does not make the user wait through ten timeouts.
  const fallbacks = await Promise.all(ports.slice(1).map((port) => tryPort(port, 3500)));
  const match = fallbacks.find(({ result }) => result);
  if (match?.result) return match.result;

  const errors = [preferred, ...fallbacks].map(({ error }) => error).filter(Boolean);
  const permissionDenied = errors.some((message) => /permission|loopback|network access|failed to fetch/i.test(message));
  if (permissionDenied) {
    throw new Error('Chrome חסם גישה למחשב המקומי. אשר לאתר הרשאת "רשת מקומית" ולחץ שוב. אם לא הופיעה בקשה, ודא ששירות Chai Launcher מותקן ופועל.');
  }
  throw new Error('שירות Chai Launcher אינו פועל. יש להפעיל או להתקין אותו פעם אחת במחשב.');
}

export async function startLocalTranscriptionServer(): Promise<LocalServerStartResult> {
  return isLocalFrontend() ? startViaVite() : startViaLauncher();
}

async function startOllamaViaVite(): Promise<LocalOllamaStartResult> {
  const response = await fetch('/__api/start-ollama', { method: 'POST' });
  const data = await readJson(response);
  if (!response.ok || !data?.ok) throw new Error(data?.error || 'הפעלת Ollama נכשלה');
  return { ok: true, message: data.message || 'started' };
}

async function startOllamaViaLauncher(): Promise<LocalOllamaStartResult> {
  const tryPort = async (port: number) => {
    try {
      const response = await fetchLocalServer(`http://127.0.0.1:${port}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ target: 'ollama' }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const data = await readJson(response);
      const result = data?.results?.ollama;
      if (!data?.ok || !result?.ok) return null;
      localStorage.setItem(LAUNCHER_PORT_KEY, String(port));
      return { ok: true, message: result.message || 'started', launcherPort: port } satisfies LocalOllamaStartResult;
    } catch {
      return null;
    }
  };

  const ports = launcherPorts();
  const preferred = await tryPort(ports[0]);
  if (preferred) return preferred;
  const fallbacks = await Promise.all(ports.slice(1).map(tryPort));
  const match = fallbacks.find(Boolean);
  if (match) return match;
  throw new Error('Chai Launcher אינו פועל או שהדפדפן חסם גישה לרשת המקומית. הפעל את Chai Launcher ואשר הרשאת רשת מקומית.');
}

/** Start the local Ollama service without starting Whisper or another server. */
export async function startLocalOllama(): Promise<LocalOllamaStartResult> {
  return isLocalFrontend() ? startOllamaViaVite() : startOllamaViaLauncher();
}

export async function getLauncherHealth(): Promise<any | null> {
  const tryPort = async (port: number) => {
    try {
      const response = await fetchLocalServer(`http://127.0.0.1:${port}/health`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3500),
      });
      if (!response.ok) return null;
      const data = await readJson(response);
      localStorage.setItem(LAUNCHER_PORT_KEY, String(port));
      const whisperPort = Number(data?.whisper?.port);
      if (data?.whisper?.running && Number.isInteger(whisperPort)) setDiscoveredServerPort(whisperPort);
      return data;
    } catch {
      return null;
    }
  };

  const ports = launcherPorts();
  const preferred = await tryPort(ports[0]);
  if (preferred) return preferred;
  const fallbacks = await Promise.all(ports.slice(1).map(tryPort));
  return fallbacks.find(Boolean) || null;
}

/**
 * Return a current local-server URL before a feature starts a local request.
 * Hosted pages can retain yesterday's dynamic port in localStorage, so ask the
 * launcher to rediscover Whisper before using that machine-specific URL.
 */
export async function resolveLocalServerUrl(): Promise<string> {
  const configured = getServerUrl();
  if (typeof window === 'undefined') return configured;
  const isLocalPage = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (!isLocalPage && isLoopbackUrl(configured)) {
    await getLauncherHealth();
    return getServerUrl();
  }
  return configured;
}
