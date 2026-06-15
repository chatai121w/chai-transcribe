import { describe, it, expect } from 'vitest';
import { normalizeServerUrl, DEFAULT_SERVER_URL } from '../lib/serverConfig';

describe('serverConfig', () => {
  describe('normalizeServerUrl', () => {
    it('returns default when input is null', () => {
      expect(normalizeServerUrl(null)).toBe(DEFAULT_SERVER_URL);
    });

    it('returns default when input is empty string', () => {
      expect(normalizeServerUrl('')).toBe(DEFAULT_SERVER_URL);
    });

    it('returns default when input is whitespace', () => {
      expect(normalizeServerUrl('   ')).toBe(DEFAULT_SERVER_URL);
    });

    it('returns default when input is undefined', () => {
      expect(normalizeServerUrl(undefined)).toBe(DEFAULT_SERVER_URL);
    });

    it('returns the URL as-is when not a legacy 3000 URL', () => {
      expect(normalizeServerUrl('http://myserver.com:5000')).toBe('http://myserver.com:5000');
    });

    it('trims whitespace from URL', () => {
      expect(normalizeServerUrl('  http://myserver.com  ')).toBe('http://myserver.com');
    });
  });

  describe('DEFAULT_SERVER_URL', () => {
    it('is /whisper', () => {
      expect(DEFAULT_SERVER_URL).toBe('/whisper');
    });
  });
});
