import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLocalServerUrl, startLocalOllama, startLocalTranscriptionServer } from './localServerLauncher';

describe('local server launcher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('uses the local Vite endpoint and stores the selected Whisper port', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ ok: true, message: 'started', port: 3001 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    const result = await startLocalTranscriptionServer();
    expect(result.port).toBe(3001);
    expect(result.serverUrl).toBe('http://127.0.0.1:3001');
    expect(localStorage.getItem('whisper_discovered_server_url')).toBe(result.serverUrl);
  });

  it('reports an HTML SPA fallback as a missing API instead of a JSON syntax error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      '<!doctype html><html></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    ));

    await expect(startLocalTranscriptionServer()).rejects.toThrow('תשובה לא תקינה');
  });

  it('starts only Ollama through the local Vite endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ ok: true, running: true, message: 'started' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(startLocalOllama()).resolves.toMatchObject({ ok: true, message: 'started' });
    expect(fetchMock).toHaveBeenCalledWith('/__api/start-ollama', { method: 'POST' });
  });

  it('refreshes a stale local port from the launcher on a hosted page', async () => {
    localStorage.setItem('whisper_discovered_server_url', 'http://127.0.0.1:3001');
    vi.stubGlobal('window', {
      location: { hostname: 'chai-transcribe.lovable.app' },
      dispatchEvent: vi.fn(),
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ ok: true, whisper: { running: true, port: 3002 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));

    await expect(resolveLocalServerUrl()).resolves.toBe('http://127.0.0.1:3002');
    expect(localStorage.getItem('whisper_discovered_server_url')).toBe('http://127.0.0.1:3002');
  });
});
