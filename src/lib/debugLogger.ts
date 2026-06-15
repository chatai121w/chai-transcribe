export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  details?: string;
}

type Listener = (entries: LogEntry[]) => void;

const STORAGE_KEY = 'debug_log_persisted';
const CRASH_KEY = 'debug_log_crash_buffer';
const SESSION_KEY = 'debug_log_session_id';
const PERF_MARKS_KEY = 'debug_log_perf_marks';

class DebugLogger {
  private entries: LogEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private nextId = 1;
  private maxEntries = 500;
  private persistInterval: ReturnType<typeof setInterval> | null = null;
  private sessionId: string;
  private perfMarks: Map<string, number> = new Map();

  constructor() {
    this.sessionId = this.initSession();
    this.restoreCrashBuffer();
    this.startPersistence();
    this.installGlobalHandlers();
  }

  /** Generate or reuse session ID */
  private initSession(): string {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  }

  /** Restore previous session crash buffer if exists */
  private restoreCrashBuffer() {
    try {
      const raw = localStorage.getItem(CRASH_KEY);
      if (!raw) return;
      const prev = JSON.parse(raw) as { sessionId: string; entries: LogEntry[] };
      if (prev.sessionId === this.sessionId) return; // same session, skip
      if (prev.entries.length > 0) {
        // Insert a separator entry
        this.entries.push({
          id: this.nextId++,
          timestamp: Date.now(),
          level: 'warn',
          source: 'CrashRecovery',
          message: `♻ לוגים מסשן קודם (${prev.entries.length} רשומות) — sessionId: ${prev.sessionId}`,
        });
        // Append last 50 entries from crashed session
        const recovered = prev.entries.slice(0, 50);
        recovered.forEach(e => {
          this.entries.push({ ...e, id: this.nextId++ });
        });
      }
    } catch {}
    // Clear old crash buffer
    localStorage.removeItem(CRASH_KEY);
  }

  /** Persist to localStorage every 3 seconds (survives refresh) */
  private startPersistence() {
    this.persistInterval = setInterval(() => {
      this.persistNow();
    }, 3000);

    // Also persist on page unload (crash/close/refresh)
    window.addEventListener('beforeunload', () => this.persistNow());
    window.addEventListener('pagehide', () => this.persistNow());
  }

  private persistNow() {
    try {
      const toSave = {
        sessionId: this.sessionId,
        entries: this.entries.slice(0, 100), // last 100 for crash recovery
        savedAt: Date.now(),
      };
      localStorage.setItem(CRASH_KEY, JSON.stringify(toSave));

      // Also save full log for export
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries.slice(0, this.maxEntries)));
    } catch {
      // localStorage full — trim
      try {
        localStorage.setItem(CRASH_KEY, JSON.stringify({
          sessionId: this.sessionId,
          entries: this.entries.slice(0, 20),
          savedAt: Date.now(),
        }));
      } catch {}
    }
  }

  /** Install global error/rejection handlers */
  private installGlobalHandlers() {
    window.addEventListener('error', (event) => {
      this.add('error', 'Global', `Uncaught: ${event.message}`, {
        filename: event.filename,
        line: event.lineno,
        col: event.colno,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error
        ? `${event.reason.message}\n${event.reason.stack}`
        : String(event.reason);
      this.add('error', 'Promise', `Unhandled rejection: ${reason}`);
    });
  }

  private emit() {
    const snapshot = [...this.entries];
    this.listeners.forEach((fn) => fn(snapshot));
  }

  private add(level: LogLevel, source: string, message: string, details?: unknown) {
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: Date.now(),
      level,
      source,
      message,
      details: details !== undefined ? (typeof details === 'string' ? details : JSON.stringify(details, null, 2)) : undefined,
    };
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(0, this.maxEntries);
    }
    this.emit();

    // Also log to real browser console with styled prefix
    const styles = {
      info: 'color: #60a5fa; font-weight: bold',
      warn: 'color: #f59e0b; font-weight: bold',
      error: 'color: #ef4444; font-weight: bold',
    };
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    consoleFn(`%c[${source}]%c ${message}`, styles[level], 'color: inherit', details ?? '');

    // Auto-persist errors immediately (don't wait 3s)
    if (level === 'error') {
      this.persistNow();
    }
  }

  info(source: string, message: string, details?: unknown) {
    this.add('info', source, message, details);
  }

  warn(source: string, message: string, details?: unknown) {
    this.add('warn', source, message, details);
  }

  error(source: string, message: string, details?: unknown) {
    this.add('error', source, message, details);
  }

  /** Start a performance timer — returns stop function */
  time(source: string, label: string): () => number {
    const key = `${source}::${label}`;
    const start = performance.now();
    this.perfMarks.set(key, start);
    return () => {
      const elapsed = performance.now() - start;
      this.perfMarks.delete(key);
      this.add('info', source, `⏱ ${label}: ${elapsed.toFixed(0)}ms`);
      return elapsed;
    };
  }

  /** Log a performance measurement inline */
  perf(source: string, label: string, durationMs: number) {
    this.add('info', source, `⏱ ${label}: ${durationMs.toFixed(0)}ms`);
  }

  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  getErrorCount(): number {
    return this.entries.filter((e) => e.level === 'error').length;
  }

  clear() {
    this.entries = [];
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CRASH_KEY);
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Get persisted log from previous session (before crash) */
  getPersistedLog(): LogEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  /** Copy-friendly text dump */
  toText(): string {
    return this.entries
      .slice()
      .reverse()
      .map((e) => {
        const time = new Date(e.timestamp).toLocaleTimeString('he-IL', { hour12: false } as Intl.DateTimeFormatOptions);
        const det = e.details ? `\n    ${e.details.replace(/\n/g, '\n    ')}` : '';
        return `[${time}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}${det}`;
      })
      .join('\n');
  }

  /** Get session ID for tracking */
  getSessionId(): string {
    return this.sessionId;
  }
}

export const debugLog = new DebugLogger();
