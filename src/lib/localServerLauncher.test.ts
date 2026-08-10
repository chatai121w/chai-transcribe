import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLocalTranscriptionServer } from './localServerLauncher';

describe('local server launcher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
});
