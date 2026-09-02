import type { TextReplacementOccurrence } from '@/lib/hebrewTextReplacement';

export type TranscriptionTraceStageId =
  | 'orthography-pre'
  | 'learned-corrections'
  | 'learned-protection'
  | 'loshon-kodesh'
  | 'vocabulary'
  | 'pronunciation-profile'
  | 'definitive-rules'
  | 'learned-restore'
  | 'orthography-final'
  | 'ai-context-fix'
  | 'orthography-after-ai';

export type TranscriptionTraceStatus = 'applied' | 'no-change' | 'skipped' | 'error';

export interface TranscriptionTraceSource {
  system: string;
  file: string;
  function: string;
  store?: string;
}

export interface TranscriptionTraceOperation {
  sequence: number;
  ruleId: string;
  source: TranscriptionTraceSource;
  beforeChecksum: string;
  afterChecksum: string;
  inputLength: number;
  outputLength: number;
  occurrences: TextReplacementOccurrence[];
  metadata?: Record<string, string | number | boolean | null>;
  /** AI providers expose the exact request/response transition, not internal model reasoning. */
  opaque?: boolean;
}

export interface TranscriptionTraceStage {
  index: number;
  id: TranscriptionTraceStageId;
  label: string;
  status: TranscriptionTraceStatus;
  enabled: boolean;
  reason?: string;
  source: TranscriptionTraceSource;
  inputChecksum: string;
  outputChecksum: string;
  inputLength: number;
  outputLength: number;
  appliedCount: number;
  operations: TranscriptionTraceOperation[];
  validationErrors: string[];
}

export interface TranscriptionTraceOverlap {
  kind: 'duplicate' | 'conflict';
  before: string;
  after: string[];
  rules: string[];
  systems: string[];
}

export interface CreateTraceOperationOptions {
  sequence: number;
  ruleId: string;
  source: TranscriptionTraceSource;
  beforeText: string;
  afterText: string;
  occurrences: TextReplacementOccurrence[];
  metadata?: Record<string, string | number | boolean | null>;
  opaque?: boolean;
}

export interface CreateTraceStageOptions {
  index: number;
  id: TranscriptionTraceStageId;
  label: string;
  enabled: boolean;
  reason?: string;
  source: TranscriptionTraceSource;
  inputText: string;
  outputText: string;
  operations?: TranscriptionTraceOperation[];
  error?: string;
}

/** Small deterministic checksum used to prove that adjacent trace revisions connect. */
export function checksumText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function replayTraceOperation(text: string, operation: TranscriptionTraceOperation): string {
  let result = text;
  for (const occurrence of [...operation.occurrences].sort((a, b) => b.inputStart - a.inputStart)) {
    if (result.slice(occurrence.inputStart, occurrence.inputEnd) !== occurrence.before) {
      throw new Error(`trace occurrence mismatch for ${operation.ruleId} at ${occurrence.inputStart}`);
    }
    result = `${result.slice(0, occurrence.inputStart)}${occurrence.after}${result.slice(occurrence.inputEnd)}`;
  }
  return result;
}

export function createTraceOperation(options: CreateTraceOperationOptions): TranscriptionTraceOperation {
  const operation: TranscriptionTraceOperation = {
    sequence: options.sequence,
    ruleId: options.ruleId,
    source: options.source,
    beforeChecksum: checksumText(options.beforeText),
    afterChecksum: checksumText(options.afterText),
    inputLength: options.beforeText.length,
    outputLength: options.afterText.length,
    occurrences: options.occurrences,
    metadata: options.metadata,
    opaque: options.opaque,
  };

  const replayed = replayTraceOperation(options.beforeText, operation);
  if (replayed !== options.afterText) {
    throw new Error(`trace replay mismatch for ${options.ruleId}`);
  }
  return operation;
}

export function createTraceStage(options: CreateTraceStageOptions): TranscriptionTraceStage {
  const operations = options.operations || [];
  const validationErrors: string[] = [];
  let expectedChecksum = checksumText(options.inputText);

  for (const operation of operations) {
    if (operation.beforeChecksum !== expectedChecksum) {
      validationErrors.push(`operation ${operation.sequence} (${operation.ruleId}) does not start at the previous revision`);
    }
    expectedChecksum = operation.afterChecksum;
  }

  const outputChecksum = checksumText(options.outputText);
  if (operations.length > 0 && expectedChecksum !== outputChecksum) {
    validationErrors.push('the final operation does not produce the stage output');
  }
  if (operations.length === 0 && checksumText(options.inputText) !== outputChecksum) {
    validationErrors.push('stage changed text without a traced operation');
  }

  return {
    index: options.index,
    id: options.id,
    label: options.label,
    status: options.error
      ? 'error'
      : !options.enabled
        ? 'skipped'
        : options.inputText === options.outputText
          ? 'no-change'
          : 'applied',
    enabled: options.enabled,
    reason: options.error || options.reason,
    source: options.source,
    inputChecksum: checksumText(options.inputText),
    outputChecksum,
    inputLength: options.inputText.length,
    outputLength: options.outputText.length,
    appliedCount: operations.reduce((sum, operation) => sum + operation.occurrences.length, 0),
    operations,
    validationErrors,
  };
}

export function validateTraceChain(stages: TranscriptionTraceStage[]): string[] {
  const errors = stages.flatMap((stage) => stage.validationErrors.map((error) => `${stage.id}: ${error}`));
  for (let index = 1; index < stages.length; index += 1) {
    if (stages[index - 1].outputChecksum !== stages[index].inputChecksum) {
      errors.push(`${stages[index - 1].id} does not connect to ${stages[index].id}`);
    }
    if (stages[index].index !== stages[index - 1].index + 1) {
      errors.push(`${stages[index].id} has a non-contiguous stage index`);
    }
  }
  return errors;
}

export function findTraceOverlaps(stages: TranscriptionTraceStage[]): TranscriptionTraceOverlap[] {
  const byInput = new Map<string, Array<{ after: string; rule: string; system: string }>>();
  for (const stage of stages) {
    for (const operation of stage.operations) {
      for (const occurrence of operation.occurrences) {
        const key = occurrence.before.normalize('NFKC').replace(/\s+/g, ' ').trim();
        if (!key) continue;
        const list = byInput.get(key) || [];
        list.push({ after: occurrence.after, rule: operation.ruleId, system: operation.source.system });
        byInput.set(key, list);
      }
    }
  }

  const overlaps: TranscriptionTraceOverlap[] = [];
  for (const [before, entries] of byInput) {
    const rules = [...new Set(entries.map(entry => entry.rule))];
    const systems = [...new Set(entries.map(entry => entry.system))];
    if (rules.length < 2 && systems.length < 2) continue;
    const after = [...new Set(entries.map(entry => entry.after))];
    overlaps.push({
      kind: after.length === 1 ? 'duplicate' : 'conflict',
      before,
      after,
      rules,
      systems,
    });
  }
  return overlaps;
}
