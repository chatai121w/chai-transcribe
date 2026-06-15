import { useState, useCallback, useEffect, useRef } from 'react';

export interface PerfRecord {
  id: string;
  timestamp: number;
  engine: string;
  fileName: string;
  fileSize: number;           // bytes
  audioDuration: number;      // seconds
  processingTime: number;     // GPU/server seconds
  wallTime: number;           // total wall clock seconds
  networkOverhead: number;    // wall - processing
  speedX: number;             // audioDuration / processingTime
  rtf: number;                // processingTime / audioDuration
  wordCount: number;
  charCount: number;
  hebrewRatio: number;        // 0-1
  timestampCount: number;     // word-level timestamps
  timestampCoverage: number;  // 0-1
  computeType?: string;
  beamSize?: number;
  model?: string;
  status: 'success' | 'failed';
  errorMessage?: string;
}

const STORAGE_KEY = 'perf_monitor_records';
const ENABLED_KEY = 'perf_monitor_enabled';
const MAX_RECORDS = 100;

function loadRecords(): PerfRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRecords(records: PerfRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
}

function calcHebrewRatio(text: string): number {
  const total = text.trim().length;
  if (!total) return 0;
  const hebrew = (text.match(/[\u0590-\u05FF]/g) || []).length;
  return hebrew / total;
}

function calcTimestampCoverage(
  words: Array<{ start: number; end: number }>,
  audioDuration: number,
): number {
  if (!words.length || !audioDuration) return 0;
  const first = words[0].start;
  const last = words[words.length - 1].end;
  return (last - first) / audioDuration;
}

export function usePerfMonitor() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(ENABLED_KEY) === '1');
  const [records, setRecords] = useState<PerfRecord[]>(() => loadRecords());
  const wallStartRef = useRef<number>(0);

  useEffect(() => { saveRecords(records); }, [records]);
  useEffect(() => { localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0'); }, [enabled]);

  const toggle = useCallback(() => setEnabled(prev => !prev), []);

  const startTimer = useCallback(() => {
    wallStartRef.current = Date.now();
  }, []);

  const record = useCallback((data: {
    engine: string;
    fileName: string;
    fileSize: number;
    audioDuration: number;
    processingTime: number;
    text: string;
    wordTimings: Array<{ word: string; start: number; end: number }>;
    computeType?: string;
    beamSize?: number;
    model?: string;
    status: 'success' | 'failed';
    errorMessage?: string;
  }) => {
    if (!enabled) return null;

    const wallTime = wallStartRef.current
      ? (Date.now() - wallStartRef.current) / 1000
      : data.processingTime;

    const entry: PerfRecord = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
      engine: data.engine,
      fileName: data.fileName,
      fileSize: data.fileSize,
      audioDuration: data.audioDuration,
      processingTime: data.processingTime,
      wallTime,
      networkOverhead: Math.max(0, wallTime - data.processingTime),
      speedX: data.audioDuration && data.processingTime
        ? data.audioDuration / data.processingTime : 0,
      rtf: data.audioDuration && data.processingTime
        ? data.processingTime / data.audioDuration : 0,
      wordCount: data.text.split(/\s+/).filter(Boolean).length,
      charCount: data.text.length,
      hebrewRatio: calcHebrewRatio(data.text),
      timestampCount: data.wordTimings.length,
      timestampCoverage: calcTimestampCoverage(data.wordTimings, data.audioDuration),
      computeType: data.computeType,
      beamSize: data.beamSize,
      model: data.model,
      status: data.status,
      errorMessage: data.errorMessage,
    };
    setRecords(prev => [entry, ...prev].slice(0, MAX_RECORDS));
    return entry;
  }, [enabled]);

  const clearRecords = useCallback(() => {
    setRecords([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { enabled, toggle, records, startTimer, record, clearRecords };
}
