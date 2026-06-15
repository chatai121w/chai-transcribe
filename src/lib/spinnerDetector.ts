import { debugLog } from './debugLogger';

/**
 * SpinnerDetector — MutationObserver-based spinner & delay detector.
 * Monitors DOM for animate-spin elements and tracks their duration.
 * Also intercepts fetch/XMLHttpRequest to flag slow requests.
 * Toggle on/off — off by default to avoid overhead.
 */

const STORAGE_KEY = 'spinner_detector_enabled';

interface TrackedSpinner {
  element: Element;
  startTime: number;
  label: string;
  logged: boolean;
}

class SpinnerDetector {
  private enabled = false;
  private observer: MutationObserver | null = null;
  private trackedSpinners: Map<Element, TrackedSpinner> = new Map();
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private originalFetch: typeof fetch | null = null;
  private listeners: Set<(enabled: boolean) => void> = new Set();

  constructor() {
    // Restore previous state
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {}
    if (this.enabled) this.start();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  toggle(): boolean {
    if (this.enabled) {
      this.stop();
    } else {
      this.start();
    }
    return this.enabled;
  }

  subscribe(fn: (enabled: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach(fn => fn(this.enabled));
  }

  start() {
    if (this.enabled && this.observer) return;
    this.enabled = true;
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch {}
    debugLog.info('SpinnerDetector', '🔍 זיהוי ספינרים הופעל');

    // Scan existing spinners
    this.scanExisting();

    // Watch for new spinners
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // New nodes added
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            this.checkElement(node);
            node.querySelectorAll('.animate-spin, [class*="animate-spin"]').forEach(el => this.checkElement(el));
          }
        }
        // Nodes removed
        for (const node of mutation.removedNodes) {
          if (node instanceof Element) {
            this.untrackElement(node);
            node.querySelectorAll('.animate-spin, [class*="animate-spin"]').forEach(el => this.untrackElement(el));
          }
        }
        // Attribute changes (class added/removed)
        if (mutation.type === 'attributes' && mutation.attributeName === 'class' && mutation.target instanceof Element) {
          const el = mutation.target;
          if (el.classList.contains('animate-spin')) {
            this.checkElement(el);
          } else {
            this.untrackElement(el);
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });

    // Periodic check for long-running spinners
    this.checkInterval = setInterval(() => this.checkDurations(), 2000);

    // Intercept fetch for slow request detection
    this.interceptFetch();

    this.emit();
  }

  stop() {
    this.enabled = false;
    try { localStorage.setItem(STORAGE_KEY, 'false'); } catch {}
    debugLog.info('SpinnerDetector', '🔍 זיהוי ספינרים כובה');

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.restoreFetch();
    this.trackedSpinners.clear();
    this.emit();
  }

  private scanExisting() {
    document.querySelectorAll('.animate-spin, [class*="animate-spin"]').forEach(el => {
      this.checkElement(el);
    });
  }

  private checkElement(el: Element) {
    if (!el.classList.contains('animate-spin')) return;
    if (this.trackedSpinners.has(el)) return;

    const label = this.getSpinnerLabel(el);
    this.trackedSpinners.set(el, {
      element: el,
      startTime: performance.now(),
      label,
      logged: false,
    });
    debugLog.info('SpinnerDetector', `⏳ ספינר הופיע: ${label}`);
  }

  private untrackElement(el: Element) {
    const tracked = this.trackedSpinners.get(el);
    if (!tracked) return;
    const duration = performance.now() - tracked.startTime;
    this.trackedSpinners.delete(el);

    const level = duration > 10000 ? 'warn' : 'info';
    debugLog[level]('SpinnerDetector', `✅ ספינר נעלם: ${tracked.label} (${(duration / 1000).toFixed(1)}s)`);
  }

  private checkDurations() {
    const now = performance.now();
    for (const [, tracked] of this.trackedSpinners) {
      const elapsed = now - tracked.startTime;

      // Warn at 5s
      if (elapsed > 5000 && !tracked.logged) {
        tracked.logged = true;
        debugLog.warn('SpinnerDetector', `⚠ ספינר ארוך: ${tracked.label} — ${(elapsed / 1000).toFixed(1)}s ועדיין פעיל`);
      }

      // Error at 15s
      if (elapsed > 15000 && tracked.logged) {
        debugLog.error('SpinnerDetector', `🚨 ספינר תקוע: ${tracked.label} — ${(elapsed / 1000).toFixed(1)}s! בדוק חיבור/שרת`);
        tracked.logged = false; // reset so it doesn't spam — will warn again after another 15s due to logged=false re-trigger
        // Actually prevent spam: set a high threshold
        tracked.startTime = now - 10000; // reset to avoid repeating
        tracked.logged = true;
      }
    }
  }

  private getSpinnerLabel(el: Element): string {
    // Try to identify what this spinner represents
    const parent = el.closest('[class*="Card"], [class*="card"], button, [role="dialog"], main, section, [class*="Suspense"]');
    const textContent = parent?.textContent?.trim().slice(0, 50) || '';

    // Check element tag and common parent patterns
    const tagName = el.tagName.toLowerCase();
    const parentTag = el.parentElement?.tagName.toLowerCase() || '';
    const buttonText = el.closest('button')?.textContent?.trim().slice(0, 30);

    if (buttonText) return `כפתור: "${buttonText}"`;

    // Check nearby text siblings
    const sibling = el.nextElementSibling || el.previousElementSibling;
    const siblingText = sibling?.textContent?.trim().slice(0, 30);
    if (siblingText) return `ליד: "${siblingText}"`;

    // Check parent class for hints
    const parentClasses = el.parentElement?.className || '';
    if (parentClasses.includes('min-h-screen') || parentClasses.includes('min-h-[50vh]')) return 'טעינת עמוד ראשי';
    if (parentClasses.includes('dialog') || parentClasses.includes('modal')) return 'דיאלוג';

    if (textContent.length > 0) return `הקשר: "${textContent.slice(0, 40)}"`;

    return `${tagName} (${parentTag})`;
  }

  /** Intercept fetch() to detect slow requests */
  private interceptFetch() {
    if (this.originalFetch) return;
    this.originalFetch = window.fetch;
    const self = this;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method || 'GET';
      const start = performance.now();

      try {
        const response = await self.originalFetch!.call(window, input, init);
        const elapsed = performance.now() - start;

        if (elapsed > 3000) {
          debugLog.warn('SpinnerDetector', `🐌 בקשה איטית: ${method} ${url.slice(0, 80)} — ${(elapsed / 1000).toFixed(1)}s (HTTP ${response.status})`);
        } else if (elapsed > 1000) {
          debugLog.info('SpinnerDetector', `📡 בקשה: ${method} ${url.slice(0, 80)} — ${elapsed.toFixed(0)}ms (HTTP ${response.status})`);
        }

        if (!response.ok) {
          debugLog.warn('SpinnerDetector', `❌ בקשה נכשלה: ${method} ${url.slice(0, 80)} — HTTP ${response.status}`);
        }

        return response;
      } catch (err) {
        const elapsed = performance.now() - start;
        debugLog.error('SpinnerDetector', `💥 בקשה קרסה: ${method} ${url.slice(0, 80)} — ${(elapsed / 1000).toFixed(1)}s`, err instanceof Error ? err.message : String(err));
        throw err;
      }
    };
  }

  private restoreFetch() {
    if (this.originalFetch) {
      window.fetch = this.originalFetch;
      this.originalFetch = null;
    }
  }

  /** Get current active spinners for display */
  getActiveSpinners(): Array<{ label: string; durationSec: number }> {
    const now = performance.now();
    return Array.from(this.trackedSpinners.values()).map(s => ({
      label: s.label,
      durationSec: (now - s.startTime) / 1000,
    }));
  }
}

export const spinnerDetector = new SpinnerDetector();
