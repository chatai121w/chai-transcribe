import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchLocalServer,
  isLoopbackUrl,
  setDiscoveredServerPort,
  shouldAutoCheckLocalServer,
} from './serverConfig';

describe('local server network configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('recognizes localhost and loopback IP addresses only', () => {
    expect(isLoopbackUrl('http://localhost:3000/health')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.1:3001/health')).toBe(true);
    expect(isLoopbackUrl('https://chai-transcribe.lovable.app')).toBe(false);
  });

  it('marks localhost fetches with the Chrome loopback address space', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    await fetchLocalServer('http://127.0.0.1:3001/health', { method: 'GET' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/health',
      expect.objectContaining({ method: 'GET', targetAddressSpace: 'loopback' }),
    );
  });

  it('persists a discovered port separately from cloud server settings', () => {
    const url = setDiscoveredServerPort(3007);
    expect(url).toBe('http://127.0.0.1:3007');
    expect(localStorage.getItem('whisper_discovered_server_url')).toBe(url);
    expect(localStorage.getItem('whisper_server_url')).toBeNull();
  });

  it('waits for a user gesture before a hosted page polls loopback', () => {
    expect(shouldAutoCheckLocalServer('http://localhost:3000', 'chai-transcribe.lovable.app', false)).toBe(false);
    expect(shouldAutoCheckLocalServer('http://localhost:3000', 'chai-transcribe.lovable.app', true)).toBe(true);
    expect(shouldAutoCheckLocalServer('/whisper', 'localhost', false)).toBe(true);
  });
});
