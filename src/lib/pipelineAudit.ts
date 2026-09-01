import { supabase } from '@/integrations/supabase/client';

export type PipelineStage =
  | 'source'
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
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

