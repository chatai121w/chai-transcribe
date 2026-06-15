import { useState, useCallback, useEffect } from 'react';

export interface TranscriptionRecord {
  id: string;
  timestamp: number;
  engine: string;
  status: 'success' | 'failed';
  fileName?: string;
  fileSize?: number;
  audioDuration?: number;
  processingTime?: number;
  rtf?: number;
  segmentCount?: number;
  charCount?: number;
  wordCount?: number;
  language?: string;
  model?: string;
  computeType?: string;
  beamSize?: number;
  fastMode?: boolean;
  errorMessage?: string;
}

export interface AnalyticsSummary {
  totalTranscriptions: number;
  successCount: number;
  failCount: number;
  successRate: number;
  totalAudioSeconds: number;
  totalProcessingSeconds: number;
  avgRtf: number;
  totalChars: number;
  totalWords: number;
  totalSegments: number;
  byEngine: Record<string, {
    count: number;
    successCount: number;
    failCount: number;
    totalAudio: number;
    totalProcessing: number;
    avgRtf: number;
    totalChars: number;
  }>;
  recentRecords: TranscriptionRecord[];
}

const STORAGE_KEY = 'transcription_analytics';
const MAX_RECORDS = 500;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadRecords(): TranscriptionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveRecords(records: TranscriptionRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS)));
}

export function useTranscriptionAnalytics() {
  const [records, setRecords] = useState<TranscriptionRecord[]>(() => loadRecords());

  // Sync to localStorage on change
  useEffect(() => {
    saveRecords(records);
  }, [records]);

  const addRecord = useCallback((record: Omit<TranscriptionRecord, 'id' | 'timestamp'>) => {
    const newRecord: TranscriptionRecord = {
      ...record,
      id: generateId(),
      timestamp: Date.now(),
    };
    setRecords(prev => [newRecord, ...prev].slice(0, MAX_RECORDS));
    return newRecord;
  }, []);

  const clearAll = useCallback(() => {
    setRecords([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const getSummary = useCallback((): AnalyticsSummary => {
    const successRecords = records.filter(r => r.status === 'success');
    const failRecords = records.filter(r => r.status === 'failed');

    const totalAudioSeconds = successRecords.reduce((sum, r) => sum + (r.audioDuration || 0), 0);
    const totalProcessingSeconds = successRecords.reduce((sum, r) => sum + (r.processingTime || 0), 0);
    const rtfRecords = successRecords.filter(r => r.rtf != null && r.rtf > 0);
    const avgRtf = rtfRecords.length > 0
      ? rtfRecords.reduce((sum, r) => sum + (r.rtf || 0), 0) / rtfRecords.length
      : 0;

    const byEngine: AnalyticsSummary['byEngine'] = {};
    for (const r of records) {
      const eng = r.engine || 'unknown';
      if (!byEngine[eng]) {
        byEngine[eng] = { count: 0, successCount: 0, failCount: 0, totalAudio: 0, totalProcessing: 0, avgRtf: 0, totalChars: 0 };
      }
      byEngine[eng].count++;
      if (r.status === 'success') {
        byEngine[eng].successCount++;
        byEngine[eng].totalAudio += r.audioDuration || 0;
        byEngine[eng].totalProcessing += r.processingTime || 0;
        byEngine[eng].totalChars += r.charCount || 0;
      } else {
        byEngine[eng].failCount++;
      }
    }
    // Calculate avgRtf per engine
    for (const eng of Object.keys(byEngine)) {
      const engRtfRecords = records.filter(r => r.engine === eng && r.status === 'success' && r.rtf != null && r.rtf > 0);
      byEngine[eng].avgRtf = engRtfRecords.length > 0
        ? engRtfRecords.reduce((sum, r) => sum + (r.rtf || 0), 0) / engRtfRecords.length
        : 0;
    }

    return {
      totalTranscriptions: records.length,
      successCount: successRecords.length,
      failCount: failRecords.length,
      successRate: records.length > 0 ? (successRecords.length / records.length) * 100 : 0,
      totalAudioSeconds,
      totalProcessingSeconds,
      avgRtf,
      totalChars: successRecords.reduce((sum, r) => sum + (r.charCount || 0), 0),
      totalWords: successRecords.reduce((sum, r) => sum + (r.wordCount || 0), 0),
      totalSegments: successRecords.reduce((sum, r) => sum + (r.segmentCount || 0), 0),
      byEngine,
      recentRecords: records.slice(0, 50),
    };
  }, [records]);

  return { records, addRecord, clearAll, getSummary };
}
