function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message} ${String(error.cause || '')}`;
  }
  if (error && typeof error === 'object') {
    return Object.values(error as Record<string, unknown>).map(String).join(' ');
  }
  return String(error);
}

/** Browser reload/navigation cancels outstanding requests and is not an application failure. */
export function isExpectedNavigationAbort(error: unknown): boolean {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return false;
  return /abort|failed to fetch/i.test(errorDetails(error));
}
