import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { debugLog, type LogEntry } from '@/lib/debugLogger';

// --- Types ---

export interface ConsoleAlert {
  id: string;
  type: 'recurring-error' | 'error-spike' | 'server-down' | 'slow-transcription' | 'high-failure-rate' | 'memory-warning';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  timestamp: number;
  count?: number;
  dismissed?: boolean;
  source?: string;
  pattern?: string;
}

export interface ErrorPattern {
  message: string;
  source: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  frequency: number; // occurrences per minute
}

export interface PerformanceMetric {
  timestamp: number;
  type: 'api-call' | 'server-health' | 'transcription';
  label: string;
  durationMs: number;
  success: boolean;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  serverUp: boolean;
  errorRate: number; // errors per minute in last 5 min
  activeAlerts: number;
  lastCheck: number;
}

export interface TrendData {
  period: string;
  errors: number;
  warnings: number;
  infos: number;
}

const ALERTS_KEY = 'smart_console_alerts';
const MAX_ALERTS = 100;
const MAX_PERF_METRICS = 200;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// --- Analysis Functions ---

function detectErrorPatterns(entries: LogEntry[], windowMinutes = 30): ErrorPattern[] {
  const now = Date.now();
  const window = windowMinutes * 60 * 1000;
  const recentErrors = entries.filter(e => e.level === 'error' && (now - e.timestamp) < window);

  const patternMap = new Map<string, { source: string; message: string; timestamps: number[] }>();

  for (const err of recentErrors) {
    // Normalize message: strip numbers, UUIDs, timestamps for grouping
    const normalized = err.message
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>')
      .replace(/\b\d{4,}\b/g, '<NUM>')
      .replace(/\b\d+\.\d+\.\d+\.\d+\b/g, '<IP>')
      .replace(/\b\d+s\b/g, '<TIME>');
    const key = `${err.source}::${normalized}`;

    if (!patternMap.has(key)) {
      patternMap.set(key, { source: err.source, message: err.message, timestamps: [] });
    }
    patternMap.get(key)!.timestamps.push(err.timestamp);
  }

  return Array.from(patternMap.values())
    .filter(p => p.timestamps.length >= 2)
    .map(p => ({
      message: p.message,
      source: p.source,
      count: p.timestamps.length,
      firstSeen: Math.min(...p.timestamps),
      lastSeen: Math.max(...p.timestamps),
      frequency: p.timestamps.length / windowMinutes,
    }))
    .sort((a, b) => b.count - a.count);
}

function calculateErrorRate(entries: LogEntry[], windowMinutes = 5): number {
  const now = Date.now();
  const window = windowMinutes * 60 * 1000;
  const recentErrors = entries.filter(e => e.level === 'error' && (now - e.timestamp) < window);
  return recentErrors.length / windowMinutes;
}

function buildTrends(entries: LogEntry[], buckets = 12, bucketMinutes = 5): TrendData[] {
  const now = Date.now();
  const result: TrendData[] = [];

  for (let i = buckets - 1; i >= 0; i--) {
    const start = now - (i + 1) * bucketMinutes * 60 * 1000;
    const end = now - i * bucketMinutes * 60 * 1000;
    const bucket = entries.filter(e => e.timestamp >= start && e.timestamp < end);

    const minutesAgo = (i + 1) * bucketMinutes;
    result.push({
      period: minutesAgo <= 60 ? `${minutesAgo}m` : `${Math.round(minutesAgo / 60)}h`,
      errors: bucket.filter(e => e.level === 'error').length,
      warnings: bucket.filter(e => e.level === 'warn').length,
      infos: bucket.filter(e => e.level === 'info').length,
    });
  }

  return result;
}

function computeSourceStats(entries: LogEntry[]): Array<{ source: string; total: number; errors: number; warns: number; infos: number }> {
  const map = new Map<string, { total: number; errors: number; warns: number; infos: number }>();

  for (const e of entries) {
    if (!map.has(e.source)) {
      map.set(e.source, { total: 0, errors: 0, warns: 0, infos: 0 });
    }
    const s = map.get(e.source)!;
    s.total++;
    if (e.level === 'error') s.errors++;
    else if (e.level === 'warn') s.warns++;
    else s.infos++;
  }

  return Array.from(map.entries())
    .map(([source, stats]) => ({ source, ...stats }))
    .sort((a, b) => b.errors - a.errors || b.total - a.total);
}

// --- Hook ---

export function useSmartConsole() {
  const [entries, setEntries] = useState<LogEntry[]>(debugLog.getEntries());
  const [alerts, setAlerts] = useState<ConsoleAlert[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(ALERTS_KEY) || '[]');
    } catch { return []; }
  });
  const [perfMetrics, setPerfMetrics] = useState<PerformanceMetric[]>([]);
  const lastAnalysisRef = useRef<number>(0);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  // Subscribe to debug log updates
  useEffect(() => {
    return debugLog.subscribe((newEntries) => {
      setEntries(newEntries);
    });
  }, []);

  // Persist alerts
  useEffect(() => {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts.slice(0, MAX_ALERTS)));
  }, [alerts]);

  // Periodic analysis — run every 10 seconds (stable interval, reads from refs)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastAnalysisRef.current < 8000) return;
      lastAnalysisRef.current = now;
      runAnalysis();
    }, 10000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAnalysis = useCallback(() => {
    const currentEntries = entriesRef.current;
    const currentAlerts = alertsRef.current;
    const newAlerts: ConsoleAlert[] = [];

    // 1. Detect recurring errors
    const patterns = detectErrorPatterns(currentEntries, 30);
    for (const pattern of patterns) {
      if (pattern.count >= 3) {
        const existing = currentAlerts.find(a =>
          a.type === 'recurring-error' && a.pattern === `${pattern.source}::${pattern.message}` && !a.dismissed
        );
        if (!existing) {
          newAlerts.push({
            id: generateId(),
            type: 'recurring-error',
            severity: pattern.count >= 10 ? 'critical' : pattern.count >= 5 ? 'warning' : 'info',
            title: `שגיאה חוזרת: ${pattern.source}`,
            description: `"${pattern.message}" — ${pattern.count} פעמים ב-30 הדקות האחרונות`,
            timestamp: Date.now(),
            count: pattern.count,
            source: pattern.source,
            pattern: `${pattern.source}::${pattern.message}`,
          });
        }
      }
    }

    // 2. Error spike detection
    const errorRate = calculateErrorRate(currentEntries, 5);
    if (errorRate > 2) {
      const existing = currentAlerts.find(a => a.type === 'error-spike' && !a.dismissed && (Date.now() - a.timestamp) < 300000);
      if (!existing) {
        newAlerts.push({
          id: generateId(),
          type: 'error-spike',
          severity: errorRate > 5 ? 'critical' : 'warning',
          title: 'עלייה חדה בשגיאות',
          description: `${errorRate.toFixed(1)} שגיאות/דקה בחמש הדקות האחרונות`,
          timestamp: Date.now(),
        });
      }
    }

    // 3. Server down detection
    const serverErrors = currentEntries.filter(e =>
      e.level === 'error' &&
      (e.source === 'CUDA Server' || e.source === 'CUDA' || e.message.toLowerCase().includes('server') || e.message.toLowerCase().includes('connection')) &&
      (Date.now() - e.timestamp) < 60000
    );
    if (serverErrors.length >= 2) {
      const existing = currentAlerts.find(a => a.type === 'server-down' && !a.dismissed && (Date.now() - a.timestamp) < 120000);
      if (!existing) {
        newAlerts.push({
          id: generateId(),
          type: 'server-down',
          severity: 'critical',
          title: 'שרת CUDA לא מגיב',
          description: `${serverErrors.length} שגיאות חיבור בדקה האחרונה`,
          timestamp: Date.now(),
        });
      }
    }

    if (newAlerts.length > 0) {
      setAlerts(prev => [...newAlerts, ...prev].slice(0, MAX_ALERTS));
    }
  }, []);

  const addPerformanceMetric = useCallback((metric: Omit<PerformanceMetric, 'timestamp'>) => {
    setPerfMetrics(prev => [{ ...metric, timestamp: Date.now() }, ...prev].slice(0, MAX_PERF_METRICS));

    // Auto-alert on slow transcriptions
    if (metric.type === 'transcription' && metric.durationMs > 600000) {
      const alert: ConsoleAlert = {
        id: generateId(),
        type: 'slow-transcription',
        severity: 'warning',
        title: 'תמלול איטי',
        description: `${metric.label} — ${(metric.durationMs / 1000).toFixed(0)} שניות`,
        timestamp: Date.now(),
      };
      setAlerts(prev => [alert, ...prev].slice(0, MAX_ALERTS));
    }
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, dismissed: true } : a));
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
    localStorage.removeItem(ALERTS_KEY);
  }, []);

  const getHealth = useCallback((): SystemHealth => {
    const errorRate = calculateErrorRate(entries, 5);
    const activeAlerts = alerts.filter(a => !a.dismissed).length;
    const serverErrors = entries.filter(e =>
      e.level === 'error' && (e.source === 'CUDA Server' || e.source === 'CUDA') && (Date.now() - e.timestamp) < 60000
    );
    const serverUp = serverErrors.length < 3;

    let status: SystemHealth['status'] = 'healthy';
    if (errorRate > 5 || !serverUp || activeAlerts >= 5) status = 'critical';
    else if (errorRate > 1 || activeAlerts >= 2) status = 'degraded';

    return { status, serverUp, errorRate, activeAlerts, lastCheck: Date.now() };
  }, [entries, alerts]);

  const getPatterns = useCallback(() => detectErrorPatterns(entries, 60), [entries]);
  const getTrends = useCallback(() => buildTrends(entries), [entries]);
  const getSourceBreakdown = useCallback(() => computeSourceStats(entries), [entries]);

  const errorCount = useMemo(() => entries.filter(e => e.level === 'error').length, [entries]);
  const warnCount = useMemo(() => entries.filter(e => e.level === 'warn').length, [entries]);
  const activeAlertCount = useMemo(() => alerts.filter(a => !a.dismissed).length, [alerts]);

  return {
    entries,
    alerts,
    perfMetrics,
    errorCount,
    warnCount,
    activeAlertCount,
    addPerformanceMetric,
    dismissAlert,
    clearAlerts,
    getHealth,
    getPatterns,
    getTrends,
    getSourceBreakdown,
    runAnalysis,
  };
}
