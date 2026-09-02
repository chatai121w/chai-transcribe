import { describe, expect, it, vi } from 'vitest';
import { isExpectedNavigationAbort } from './navigationAbort';

describe('isExpectedNavigationAbort', () => {
  it('suppresses aborted requests only while the document is hidden', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(isExpectedNavigationAbort({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isExpectedNavigationAbort(new Error('net::ERR_ABORTED'))).toBe(true);
  });

  it('keeps visible-page and unrelated failures actionable', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    expect(isExpectedNavigationAbort(new Error('net::ERR_ABORTED'))).toBe(false);
    expect(isExpectedNavigationAbort(new Error('permission denied'))).toBe(false);
  });
});
