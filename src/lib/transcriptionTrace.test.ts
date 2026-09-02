import { beforeEach, describe, expect, it, vi } from 'vitest';
import { learnFromCorrections } from '@/utils/correctionLearning';
import { setDefinitiveRulesEnabled } from '@/utils/hebrewRuleEngine';
import { setPersonalPronunciationEnabled } from './personalPronunciationModel';
import { applyLkAiFix, setLoshonKodeshReplacements } from './loshonKodesh';
import { applyTranscriptionKnowledge, applyTranscriptionKnowledgeWithAi } from './transcriptionKnowledge';
import {
  checksumText,
  createTraceOperation,
  createTraceStage,
  replayTraceOperation,
  validateTraceChain,
} from './transcriptionTrace';

vi.mock('./loshonKodesh', async () => {
  const actual = await vi.importActual<typeof import('./loshonKodesh')>('./loshonKodesh');
  return { ...actual, applyLkAiFix: vi.fn() };
});

const mockedApplyLkAiFix = vi.mocked(applyLkAiFix);

function replayPipeline(input: string, result: ReturnType<typeof applyTranscriptionKnowledge>): string {
  let current = input;
  for (const stage of result.trace) {
    expect(checksumText(current)).toBe(stage.inputChecksum);
    for (const operation of stage.operations) {
      current = replayTraceOperation(current, operation);
    }
    expect(checksumText(current)).toBe(stage.outputChecksum);
  }
  return current;
}

describe('exact transcription trace ledger', () => {
  beforeEach(() => {
    localStorage.clear();
    setPersonalPronunciationEnabled(false);
    setDefinitiveRulesEnabled(true);
    mockedApplyLkAiFix.mockReset();
  });

  it('replays every deterministic change exactly and identifies its source code', () => {
    const input = 'שלומ פדיון הקדיש  מלךים';
    const result = applyTranscriptionKnowledge(input, 'trace-test', { loshonKodesh: true });

    expect(replayPipeline(input, result)).toBe(result.text);
    expect(result.traceValidationErrors).toEqual([]);
    expect(result.trace).toHaveLength(9);
    for (const stage of result.trace) {
      expect(stage.source.file).toMatch(/^src\//);
      expect(stage.source.function).toBeTruthy();
      expect(stage.validationErrors).toEqual([]);
    }
    const lkRule = result.trace
      .find(stage => stage.id === 'loshon-kodesh')
      ?.operations.find(operation => operation.ruleId.includes('פדיון הקדיש'));
    expect(lkRule).toEqual(expect.objectContaining({
      source: expect.objectContaining({
        file: 'src/lib/loshonKodesh.ts',
        function: 'applyLoshonKodeshReplacementsDetailed',
      }),
    }));
    expect(lkRule?.occurrences).toEqual([expect.objectContaining({
      before: 'פדיון הקדיש',
      after: 'פדיון הקדש',
      inputStart: expect.any(Number),
      outputStart: expect.any(Number),
    })]);
  });

  it('shows learned correction, protection, restoration and final orthography as separate revisions', () => {
    setPersonalPronunciationEnabled(true);
    setLoshonKodeshReplacements([{ from: 'ארוממך', to: 'שיבוש', category: 'terms' }]);
    learnFromCorrections([{
      original: 'ארומך',
      corrected: 'ארוממך',
      frequency: 3,
      engine: 'trace-test',
      category: 'word',
      confidence: 1,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    }]);

    const result = applyTranscriptionKnowledge('ארומך', 'trace-test', { loshonKodesh: true });

    expect(result.text).toBe('ארוממך');
    expect(result.traceValidationErrors).toEqual([]);
    expect(replayPipeline('ארומך', result)).toBe('ארוממך');
    expect(result.trace.find(stage => stage.id === 'learned-corrections')?.status).toBe('applied');
    expect(result.trace.find(stage => stage.id === 'learned-protection')?.operations).toHaveLength(1);
    expect(result.trace.find(stage => stage.id === 'loshon-kodesh')?.operations).toHaveLength(0);
    expect(result.trace.find(stage => stage.id === 'learned-restore')?.operations).toHaveLength(1);
  });

  it('records the exact AI boundary and the mandatory post-AI gate', async () => {
    mockedApplyLkAiFix.mockResolvedValue('שלומ םשה');

    const result = await applyTranscriptionKnowledgeWithAi('טקסט תקין', 'trace-test', {
      loshonKodesh: true,
      ai: true,
    });

    expect(result.text).toBe('שלום משה');
    expect(result.traceValidationErrors).toEqual([]);
    expect(result.trace.map(stage => stage.id).slice(-2)).toEqual(['ai-context-fix', 'orthography-after-ai']);
    const aiOperation = result.trace.find(stage => stage.id === 'ai-context-fix')?.operations[0];
    expect(aiOperation?.opaque).toBe(true);
    expect(aiOperation?.occurrences[0]).toEqual(expect.objectContaining({
      before: 'טקסט תקין',
      after: 'שלומ םשה',
    }));
  });

  it('marks an untraced text mutation as invalid', () => {
    const stage = createTraceStage({
      index: 0,
      id: 'vocabulary',
      label: 'invalid fixture',
      enabled: true,
      source: { system: 'fixture', file: 'src/test.ts', function: 'fixture' },
      inputText: 'ילדים',
      outputText: 'ילדות',
      operations: [],
    });

    expect(stage.validationErrors).toContain('stage changed text without a traced operation');
  });

  it('is idempotent after the canonical result has already been normalized', () => {
    const first = applyTranscriptionKnowledge('שלומ מלךים פדיון הקדיש', 'trace-test', {
      loshonKodesh: true,
    });
    const second = applyTranscriptionKnowledge(first.text, 'trace-test', {
      loshonKodesh: true,
    });

    expect(first.text).toBe('שלום מלכים פדיון הקדש');
    expect(second.text).toBe(first.text);
    expect(second.totalApplied).toBe(0);
    expect(second.traceValidationErrors).toEqual([]);
    expect(second.trace.every(stage => stage.operations.length === 0)).toBe(true);
  });

  it('rejects replay when an occurrence points at the wrong source text', () => {
    const valid = createTraceOperation({
      sequence: 0,
      ruleId: 'fixture:children',
      source: { system: 'fixture', file: 'src/test.ts', function: 'fixture' },
      beforeText: 'ילדים',
      afterText: 'ילדות',
      occurrences: [{
        inputStart: 0,
        inputEnd: 5,
        outputStart: 0,
        outputEnd: 5,
        before: 'ילדים',
        after: 'ילדות',
      }],
    });

    expect(() => replayTraceOperation('ילדיו', valid)).toThrow('trace occurrence mismatch');
  });

  it('detects a disconnected stage chain and a non-contiguous index', () => {
    const first = createTraceStage({
      index: 0,
      id: 'orthography-pre',
      label: 'first',
      enabled: true,
      source: { system: 'fixture', file: 'src/test.ts', function: 'first' },
      inputText: 'שלומ',
      outputText: 'שלומ',
    });
    const disconnected = createTraceStage({
      index: 2,
      id: 'learned-corrections',
      label: 'second',
      enabled: true,
      source: { system: 'fixture', file: 'src/test.ts', function: 'second' },
      inputText: 'טקסט אחר',
      outputText: 'טקסט אחר',
    });

    expect(validateTraceChain([first, disconnected])).toEqual(expect.arrayContaining([
      'orthography-pre does not connect to learned-corrections',
      'learned-corrections has a non-contiguous stage index',
    ]));
  });

  it('records an AI overwrite exactly and still enforces final orthography afterwards', async () => {
    mockedApplyLkAiFix.mockResolvedValue('ילדימ');

    const result = await applyTranscriptionKnowledgeWithAi('ילדים', 'trace-test', {
      loshonKodesh: true,
      ai: true,
    });

    expect(result.text).toBe('ילדים');
    expect(result.traceValidationErrors).toEqual([]);
    expect(result.trace.find(stage => stage.id === 'ai-context-fix')?.operations[0]).toMatchObject({
      ruleId: 'ai:model-response',
      opaque: true,
    });
    expect(result.trace.find(stage => stage.id === 'orthography-after-ai')?.status).toBe('applied');
  });
});
