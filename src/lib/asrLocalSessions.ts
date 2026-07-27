/**
 * Local persistence for ASR training sessions.
 * Stores source text, transcription hypotheses, metrics, and corrections
 * in localStorage alongside the cloud copy.
 */

const KEY = 'asr_training_sessions_v1';
const MAX_SESSIONS = 50;

export interface LocalSession {
  id: string;
  createdAt: number;
  label: string;
  sourceKind: 'tanakh' | 'text';
  sourceRef: string | null;
  refText: string;
  audioFilename: string | null;
  learningMode: string;
  results: Array<{
    engine: string;
    model: string;
    hyp: string;
    metrics: {
      wer: number; cer: number; termRecall: number; lenRatio: number;
      sub: number; ins: number; del: number; elapsedMs: number;
    };
    candidates: Array<{ wrong: string; correct: string }>;
  }>;
  autoApplied: Array<{ wrong: string; correct: string; occurrences: number; engine: string }>;
  pending: Array<{ wrong: string; correct: string; engine: string }>;
}

export function loadLocalSessions(): LocalSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveLocalSession(s: LocalSession): void {
  const all = loadLocalSessions();
  all.unshift(s);
  const trimmed = all.slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch (err) {
    // Likely quota exceeded — drop oldest half and retry
    try {
      localStorage.setItem(KEY, JSON.stringify(trimmed.slice(0, Math.floor(MAX_SESSIONS / 2))));
    } catch {
      console.warn('Local session save failed:', err);
    }
  }
}

export function deleteLocalSession(id: string): void {
  const all = loadLocalSessions().filter((s) => s.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function clearLocalSessions(): void {
  localStorage.removeItem(KEY);
}

export function exportLocalSessionsJson(): string {
  return JSON.stringify(loadLocalSessions(), null, 2);
}

export function removePendingCorrectionsFromLocalSessions(items: Array<{ wrong: string; correct: string }>): void {
  const keys = new Set(items.map((item) => `${item.wrong.trim()}→${item.correct.trim()}`));
  if (keys.size === 0) return;

  const updated = loadLocalSessions().map((session) => ({
    ...session,
    pending: session.pending.filter((item) => !keys.has(`${item.wrong.trim()}→${item.correct.trim()}`)),
  }));
  localStorage.setItem(KEY, JSON.stringify(updated));
}
