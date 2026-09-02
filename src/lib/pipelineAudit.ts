import { supabase } from '@/integrations/supabase/client';
import type { TranscriptionKnowledgeResult } from '@/lib/transcriptionKnowledge';

export type PipelineStage =
  | 'source'
  | 'audio-preprocessing'
  | 'configuration'
  | 'upload'
  | 'transcription'
  | 'knowledge'
  | 'metrics'
  | 'quality-gate'
  | 'review'
  | 'lexicon'
  | 'training'
  | 'complete';

export type PipelineEventLevel = 'info' | 'success' | 'warning' | 'error';

export interface PipelineAuditEvent {
  id: string;
  experimentId: string;
  recordingFingerprint?: string;
  comparisonRunId?: string;
  stage: PipelineStage;
  level: PipelineEventLevel;
  eventType: string;
  message: string;
  details: Record<string, unknown>;
  createdAt: string;
}

const STORAGE_KEY = 'asr_pipeline_events_v1';
const MAX_LOCAL_EVENTS = 1000;
const MAX_LOCAL_SERIALIZED_CHARS = 1_500_000;
export const PIPELINE_EVENT_NAME = 'asr-pipeline-event';

function loadStoredEvents(): PipelineAuditEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistLocal(event: PipelineAuditEvent): void {
  const events = [event, ...loadStoredEvents()].slice(0, MAX_LOCAL_EVENTS);
  let serialized = JSON.stringify(events);
  while (events.length > 1 && serialized.length > MAX_LOCAL_SERIALIZED_CHARS) {
    events.pop();
    serialized = JSON.stringify(events);
  }
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    // Audit persistence must never block saving a transcription. Keep a compact
    // diagnostic locally; the complete event is still sent to the cloud below.
    const compact: PipelineAuditEvent = {
      ...event,
      level: 'warning',
      eventType: `${event.eventType}-local-payload-omitted`,
      message: `${event.message} (הפרטים המלאים גדולים מדי לאחסון המקומי)`,
      details: {
        originalEventType: event.eventType,
        surface: event.details.surface || null,
        engine: event.details.engine || null,
        traceVersion: event.details.traceVersion || null,
      },
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([compact]));
    } catch {
      // Private mode or a disabled storage backend: cloud + live event remain available.
    }
    console.warn('[ASR pipeline] local audit persistence failed', error);
  }
  window.dispatchEvent(new CustomEvent(PIPELINE_EVENT_NAME, { detail: event }));
}

export function listPipelineEvents(experimentId?: string): PipelineAuditEvent[] {
  const events = loadStoredEvents();
  return experimentId ? events.filter((event) => event.experimentId === experimentId) : events;
}

export function clearPipelineEvents(experimentId?: string): void {
  if (!experimentId) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(loadStoredEvents().filter((event) => event.experimentId !== experimentId)),
  );
}

export async function logPipelineEvent(
  input: Omit<PipelineAuditEvent, 'id' | 'createdAt'>,
): Promise<PipelineAuditEvent> {
  const event: PipelineAuditEvent = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  persistLocal(event);

  const logMethod = event.level === 'error' ? console.error : event.level === 'warning' ? console.warn : console.info;
  logMethod(`[ASR pipeline][${event.experimentId}][${event.stage}] ${event.message}`, event.details);

  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return event;
    await (supabase as any).from('asr_pipeline_events').insert({
      user_id: data.user.id,
      experiment_id: event.experimentId,
      comparison_run_id: event.comparisonRunId || null,
      recording_fingerprint: event.recordingFingerprint || null,
      stage: event.stage,
      level: event.level,
      event_type: event.eventType,
      message: event.message,
      details: event.details,
      created_at: event.createdAt,
    });
  } catch (error) {
    console.warn('[ASR pipeline] cloud audit write failed', error);
  }
  return event;
}

export interface KnowledgeTraceAuditInput {
  experimentId: string;
  surface: string;
  engine: string;
  knowledge: Pick<
    TranscriptionKnowledgeResult,
    'trace' | 'traceValidationErrors' | 'traceOverlaps' | 'counts' | 'totalApplied' | 'aiError'
  >;
  recordingFingerprint?: string;
  comparisonRunId?: string;
  initialText?: string;
  onEvent?: (event: PipelineAuditEvent) => void;
}

/** Persist one canonical knowledge trace, regardless of the UI surface that ran it. */
export async function logKnowledgeTrace(input: KnowledgeTraceAuditInput): Promise<PipelineAuditEvent[]> {
  const events: PipelineAuditEvent[] = [];
  const append = async (
    level: PipelineEventLevel,
    eventType: string,
    message: string,
    details: Record<string, unknown>,
  ) => {
    const event = await logPipelineEvent({
      experimentId: input.experimentId,
      recordingFingerprint: input.recordingFingerprint,
      comparisonRunId: input.comparisonRunId,
      stage: 'knowledge',
      level,
      eventType,
      message,
      details: {
        traceVersion: 1,
        surface: input.surface,
        engine: input.engine,
        ...details,
      },
    });
    events.push(event);
    input.onEvent?.(event);
  };

  for (const stage of input.knowledge.trace) {
    await append(
      stage.validationErrors.length > 0 || stage.status === 'error'
        ? 'error'
        : stage.status === 'skipped'
          ? 'info'
          : 'success',
      'knowledge-trace-stage',
      `${stage.index + 1}. ${stage.label}: ${stage.status}`,
      {
        stage,
        initialText: stage.index === 0 ? input.initialText || null : null,
      },
    );
  }

  await append(
    input.knowledge.traceValidationErrors.length > 0 ? 'error' : 'success',
    input.knowledge.traceValidationErrors.length > 0 ? 'knowledge-trace-invalid' : 'knowledge-trace-valid',
    input.knowledge.traceValidationErrors.length > 0
      ? 'נמצא שינוי שאינו ניתן לשחזור מלא מן ה-Trace'
      : 'שרשרת ה-Trace נבדקה וניתנת לשחזור מלא',
    {
      traceStageCount: input.knowledge.trace.length,
      totalApplied: input.knowledge.totalApplied,
      counts: input.knowledge.counts,
      validationErrors: input.knowledge.traceValidationErrors,
      overlaps: input.knowledge.traceOverlaps,
      aiError: input.knowledge.aiError || null,
    },
  );

  return events;
}

