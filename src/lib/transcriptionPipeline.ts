import { computeCER, computeOrthographicCER, computeOrthographicWER, computeTermRecall, computeWER, lenRatio } from '@/lib/asrMetrics';
import { recordRun } from '@/lib/comparisonRuns';
import { getServerUrl } from '@/lib/serverConfig';
import { applyTranscriptionKnowledgeWithAi } from '@/lib/transcriptionKnowledge';
import type { TranscriptionTraceOverlap, TranscriptionTraceStage } from '@/lib/transcriptionTrace';
import { buildTranscriptionHotwords } from '@/lib/transcriptionHotwords';
import { getLoshonKodeshPrompt } from '@/lib/loshonKodesh';
import { fingerprintFile } from '@/lib/recordingFingerprint';
import { runCloudRetranscription, type RetranscriptionResult, type TranscriptionEngineId } from '@/lib/retranscriptionRunner';
import { logKnowledgeTrace, logPipelineEvent, type PipelineAuditEvent } from '@/lib/pipelineAudit';
import { getAllTerms } from '@/utils/customVocabulary';
import type { AsrSampleType } from '@/lib/asrSampleType';

export type PipelineVariant = 'baseline' | 'candidate';

export interface PipelineMetrics {
  wer: number;
  cer: number;
  orthographicWer: number;
  orthographicCer: number;
  termRecall: number;
  lenRatio: number;
}

export interface PipelineRunOptions {
  experimentId: string;
  variant: PipelineVariant;
  file: File;
  engine: TranscriptionEngineId;
  model?: string;
  language?: string;
  groundTruth?: string;
  useKnowledge: boolean;
  loshonKodesh: boolean;
  useAiKnowledge?: boolean;
  manualHotwords?: string;
  sampleType?: AsrSampleType;
  targetTerms?: string[];
  recordingFingerprint?: string;
  recordingLabel?: string;
  audioPreprocessing?: {
    mode: string;
    preset: string | null;
    input: 'original' | 'processed';
  };
  signal?: AbortSignal;
  onProgress?: (progress: number, status: string) => void;
  onEvent?: (event: PipelineAuditEvent) => void;
}

export interface LocalStreamParseResult {
  text: string;
  wordTimings: RetranscriptionResult['wordTimings'];
  duration?: number;
  language?: string;
  model?: string;
}

export interface PipelineRunResult {
  variant: PipelineVariant;
  experimentId: string;
  recordingFingerprint: string;
  rawText: string;
  text: string;
  engine: TranscriptionEngineId;
  engineLabel: string;
  model?: string;
  wordTimings: RetranscriptionResult['wordTimings'];
  metrics?: PipelineMetrics;
  elapsedMs: number;
  appliedKnowledge: number;
  knowledgeTrace: TranscriptionTraceStage[];
  traceValidationErrors: string[];
  traceOverlaps: TranscriptionTraceOverlap[];
  comparisonRunId?: string;
}

async function emit(
  options: PipelineRunOptions,
  recordingFingerprint: string,
  stage: Parameters<typeof logPipelineEvent>[0]['stage'],
  level: Parameters<typeof logPipelineEvent>[0]['level'],
  eventType: string,
  message: string,
  details: Record<string, unknown> = {},
  comparisonRunId?: string,
): Promise<void> {
  const event = await logPipelineEvent({
    experimentId: options.experimentId,
    recordingFingerprint,
    comparisonRunId,
    stage,
    level,
    eventType,
    message,
    details: { variant: options.variant, engine: options.engine, model: options.model || null, ...details },
  });
  options.onEvent?.(event);
}

export async function parseLocalTranscriptionStream(
  response: Response,
  onProgress?: (progress: number, status: string) => void,
): Promise<LocalStreamParseResult> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('השרת המקומי לא החזיר זרם נתונים');

  const decoder = new TextDecoder();
  let buffer = '';
  const textParts: string[] = [];
  const wordTimings: RetranscriptionResult['wordTimings'] = [];
  let duration: number | undefined;
  let language: string | undefined;
  let model: string | undefined;
  let completedText = '';
  let completedTimings: RetranscriptionResult['wordTimings'] | undefined;

  const consumeLine = (line: string) => {
    if (!line.startsWith('data: ')) return;
    const raw = line.slice(6).trim();
    if (!raw) return;
    let event: any;
    try { event = JSON.parse(raw); } catch { return; }
    if (event.type === 'error') throw new Error(event.error || 'תמלול הזרם נכשל');
    if (event.type === 'loading') onProgress?.(20, event.message || 'טוען מודל');
    if (event.type === 'info' || event.type === 'source') {
      duration = Number(event.duration) || duration;
      language = event.language || language;
      model = event.model || model;
    }
    if (event.type === 'segment') {
      if (event.paragraphBreak) textParts.push('\n\n');
      if (event.text) textParts.push(String(event.text));
      if (Array.isArray(event.words)) wordTimings.push(...event.words);
      onProgress?.(Number(event.progress) || 0, 'מתמלל בנתיב הייצור המקומי');
    }
    if (event.type === 'done') {
      completedText = String(event.text || '').trim();
      completedTimings = Array.isArray(event.wordTimings)
        ? event.wordTimings
        : Array.isArray(event.word_timings)
          ? event.word_timings
          : undefined;
      duration = Number(event.duration) || duration;
      language = event.language || language;
      model = event.model || model;
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) consumeLine(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeLine(buffer);

  const text = completedText || textParts.join(' ').replace(/\s+\n\s+/g, '\n').trim();
  if (!text) throw new Error('השרת המקומי סיים ללא תמלול');
  return {
    text,
    wordTimings: completedTimings || wordTimings,
    duration,
    language,
    model,
  };
}

async function runLocalServer(
  options: PipelineRunOptions,
  hotwords?: string,
): Promise<RetranscriptionResult> {
  const form = new FormData();
  form.append('file', options.file, options.file.name);
  form.append('language', options.language || 'he');
  if (options.model) form.append('model', options.model);
  if (hotwords) form.append('hotwords', hotwords);
  if (options.loshonKodesh && options.useKnowledge) {
    form.append('loshon_kodesh', '1');
    form.append('initial_prompt', getLoshonKodeshPrompt());
  }
  options.onProgress?.(15, 'מעלה את קובץ המקור לשרת המקומי');
  const response = await fetch(`${getServerUrl()}/transcribe-stream`, { method: 'POST', body: form, signal: options.signal });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || payload.detail || `שגיאת שרת ${response.status}`);
  }
  const payload = await parseLocalTranscriptionStream(response, options.onProgress);
  const text = payload.text.trim();
  options.onProgress?.(85, 'התמלול המקומי הסתיים');
  return {
    text,
    wordTimings: payload.wordTimings,
    engine: 'local-server',
    engineLabel: `Local CUDA (${options.model || payload.model || 'default'})`,
    detectedLanguage: payload.language,
    model: options.model || payload.model,
  };
}

function calculateMetrics(reference: string, hypothesis: string, targetTerms?: string[]): PipelineMetrics {
  const terms = targetTerms?.length
    ? [...new Set(targetTerms.map((term) => term.trim()).filter(Boolean))]
    : getAllTerms().filter((entry) => entry.approvalStatus === 'verified').map((entry) => entry.term);
  return {
    wer: computeWER(reference, hypothesis).wer,
    cer: computeCER(reference, hypothesis).cer,
    orthographicWer: computeOrthographicWER(reference, hypothesis).wer,
    orthographicCer: computeOrthographicCER(reference, hypothesis).cer,
    termRecall: computeTermRecall(reference, hypothesis, terms).recall,
    lenRatio: lenRatio(reference, hypothesis),
  };
}

export async function runTranscriptionPipeline(options: PipelineRunOptions): Promise<PipelineRunResult> {
  const fingerprint = options.recordingFingerprint || await fingerprintFile(options.file);
  const started = performance.now();
  await emit(options, fingerprint, 'source', 'success', 'source-ready', 'קובץ המקור זוהה ונחתם', {
    fileName: options.file.name,
    fileSize: options.file.size,
    fileType: options.file.type,
    recordingLabel: options.recordingLabel || options.file.name,
    sampleType: options.sampleType || 'other',
    audioPreprocessing: options.audioPreprocessing || { mode: 'off', preset: null, input: 'original' },
    localTransport: options.engine === 'local-server' ? 'transcribe-stream' : null,
  });

  const hotwords = options.useKnowledge
    ? buildTranscriptionHotwords({
        manual: options.manualHotwords,
        context: options.file.name,
        loshonKodesh: options.loshonKodesh,
      })
    : undefined;
  await emit(options, fingerprint, 'configuration', 'info', 'configuration-resolved', 'הגדרות הריצה ננעלו', {
    useKnowledge: options.useKnowledge,
    loshonKodesh: options.loshonKodesh,
    useAiKnowledge: Boolean(options.useAiKnowledge),
    hotwordsCount: hotwords ? hotwords.split(',').filter(Boolean).length : 0,
    hasGroundTruth: Boolean(options.groundTruth?.trim()),
    sampleType: options.sampleType || 'other',
    targetTermsCount: options.targetTerms?.length || 0,
    termMetricScope: options.targetTerms?.length ? 'recording-targets' : 'verified-lexicon',
    audioPreprocessing: options.audioPreprocessing || { mode: 'off', preset: null, input: 'original' },
  });

  try {
    options.onProgress?.(5, 'מתחיל תמלול');
    await emit(options, fingerprint, 'upload', 'info', 'source-transfer-started', 'התחילה העברת קובץ המקור למנוע', {
      destination: options.engine === 'local-server' ? 'שרת CUDA מקומי' : 'ספק תמלול חיצוני',
      reason: 'המנוע חייב לקבל את אותם בתים של המקור כדי שהשוואת A/B תהיה תקפה',
    });
    await emit(options, fingerprint, 'transcription', 'info', 'transcription-started', 'התמלול התחיל');
    const transcription = options.engine === 'local-server'
      ? await runLocalServer(options, hotwords)
      : await runCloudRetranscription({
          engine: options.engine as Exclude<TranscriptionEngineId, 'local-server' | 'local'>,
          file: options.file,
          language: options.language || 'he',
          model: options.model,
          customVocabulary: hotwords?.split(',').map((term) => term.trim()).filter(Boolean),
          signal: options.signal,
          onProgress: (progress, status) => options.onProgress?.(progress, status || 'מתמלל בענן'),
        });
    await emit(options, fingerprint, 'upload', 'success', 'source-transfer-completed', 'קובץ המקור נקלט ועובד על ידי המנוע', {
      retainedOriginal: true,
      reason: 'השלב הושלם לפני קבלת תוצאת התמלול',
    });
    const rawText = transcription.text.trim();
    await emit(options, fingerprint, 'transcription', 'success', 'transcription-completed', 'המנוע החזיר תמלול', {
      rawWordCount: rawText.split(/\s+/).filter(Boolean).length,
      timingCount: transcription.wordTimings.length,
      requestedModel: transcription.requestedModel || options.model || null,
      usedModel: transcription.model || options.model || null,
      provider: transcription.provider || null,
      fallbackReason: transcription.fallbackReason || null,
    });

    const knowledge = options.useKnowledge
      ? await applyTranscriptionKnowledgeWithAi(rawText, transcription.engineLabel, {
          loshonKodesh: options.loshonKodesh,
          ai: Boolean(options.useAiKnowledge),
        })
      : {
          text: rawText,
          totalApplied: 0,
          deterministicApplied: 0,
          learnedApplied: [],
          counts: { definitive: 0, learned: 0, profile: 0, vocabulary: 0, loshonKodesh: 0, orthography: 0, ai: 0 },
          changes: [],
          trace: [],
          traceValidationErrors: [],
          traceOverlaps: [],
        };
    if (options.useKnowledge) {
      await logKnowledgeTrace({
        experimentId: options.experimentId,
        recordingFingerprint: fingerprint,
        surface: 'transcription-lab',
        engine: transcription.engineLabel,
        knowledge,
        initialText: rawText,
        onEvent: options.onEvent,
      });
    }
    if (!options.useKnowledge) {
      await emit(options, fingerprint, 'knowledge', 'info', 'knowledge-trace-skipped', 'ריצת הבסיס דילגה על צינור הידע כולו', {
        traceVersion: 1,
        sourceFile: 'src/lib/transcriptionPipeline.ts',
        sourceFunction: 'runTranscriptionPipeline',
      });
    }
    await emit(options, fingerprint, 'knowledge', 'success', 'knowledge-applied', options.useKnowledge ? 'צינור הידע הופעל פעם אחת' : 'ריצת בסיס ללא צינור ידע', {
      totalApplied: knowledge.totalApplied,
      counts: knowledge.counts,
      changes: knowledge.changes,
      traceStageCount: knowledge.trace.length,
      traceValidationErrors: knowledge.traceValidationErrors,
      traceOverlaps: knowledge.traceOverlaps,
      aiError: knowledge.aiError || null,
    });
    if (knowledge.aiError) {
      await emit(options, fingerprint, 'knowledge', 'warning', 'knowledge-ai-fallback', 'תיקון AI נכשל; נשמרה תוצאת הכללים הדטרמיניסטית', {
        error: knowledge.aiError,
      });
    }

    const text = knowledge.text.trim();
    const metrics = options.groundTruth?.trim()
      ? calculateMetrics(options.groundTruth.trim(), text, options.targetTerms)
      : undefined;
    if (metrics) {
      await emit(options, fingerprint, 'metrics', 'success', 'metrics-calculated', 'מדדי האיכות חושבו מול טקסט האמת', metrics as unknown as Record<string, unknown>);
    } else {
      await emit(options, fingerprint, 'metrics', 'warning', 'metrics-skipped', 'לא הוגדר טקסט אמת ולכן לא חושבו WER ו-CER');
    }

    const elapsedMs = Math.round(performance.now() - started);
    const cloudRun = await recordRun({
      kind: 'asr_ground_truth',
      recording_fingerprint: fingerprint,
      recording_label: options.recordingLabel || options.file.name,
      engine: transcription.engineLabel,
      model: transcription.model || options.model || null,
      config_snapshot: {
        experimentId: options.experimentId,
        variant: options.variant,
        useKnowledge: options.useKnowledge,
        loshonKodesh: options.loshonKodesh,
        useAiKnowledge: Boolean(options.useAiKnowledge),
        hotwordsCount: hotwords ? hotwords.split(',').filter(Boolean).length : 0,
        sampleType: options.sampleType || 'other',
        targetTerms: options.targetTerms || [],
        termMetricScope: options.targetTerms?.length ? 'recording-targets' : 'verified-lexicon',
        audioPreprocessing: options.audioPreprocessing || { mode: 'off', preset: null, input: 'original' },
        localTransport: options.engine === 'local-server' ? 'transcribe-stream' : null,
      },
      hotwords_count: hotwords ? hotwords.split(',').filter(Boolean).length : 0,
      corrections_count: knowledge.totalApplied,
      reference_text: options.groundTruth?.trim() || null,
      hypothesis_text: text,
      wer: metrics?.wer ?? null,
      cer: metrics?.cer ?? null,
      term_recall: metrics?.termRecall ?? null,
      len_ratio: metrics?.lenRatio ?? null,
      elapsed_ms: elapsedMs,
    });
    await emit(options, fingerprint, 'complete', 'success', 'run-completed', 'הריצה הסתיימה ונשמרה', {
      elapsedMs,
      comparisonRunId: cloudRun?.id || null,
    }, cloudRun?.id);
    options.onProgress?.(100, 'הריצה הושלמה');

    return {
      variant: options.variant,
      experimentId: options.experimentId,
      recordingFingerprint: fingerprint,
      rawText,
      text,
      engine: transcription.engine,
      engineLabel: transcription.engineLabel,
      model: transcription.model || options.model,
      wordTimings: transcription.wordTimings,
      metrics,
      elapsedMs,
      appliedKnowledge: knowledge.totalApplied,
      knowledgeTrace: knowledge.trace,
      traceValidationErrors: knowledge.traceValidationErrors,
      traceOverlaps: knowledge.traceOverlaps,
      comparisonRunId: cloudRun?.id,
    };
  } catch (error) {
    await emit(options, fingerprint, 'complete', 'error', 'run-failed', 'הריצה נכשלה', {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Math.round(performance.now() - started),
    });
    throw error;
  }
}

export function comparePipelineResults(baseline: PipelineRunResult, candidate: PipelineRunResult) {
  if (!baseline.metrics || !candidate.metrics) return null;
  const werImprovement = baseline.metrics.wer - candidate.metrics.wer;
  const cerImprovement = baseline.metrics.cer - candidate.metrics.cer;
  const hasTermRecall = Number.isFinite(baseline.metrics.termRecall) && Number.isFinite(candidate.metrics.termRecall);
  const termRecallImprovement = hasTermRecall
    ? candidate.metrics.termRecall - baseline.metrics.termRecall
    : 0;
  const regressed = werImprovement < -0.0001 || cerImprovement < -0.0001 || termRecallImprovement < -0.0001;
  const improved = !regressed && (werImprovement > 0.0001 || cerImprovement > 0.0001 || termRecallImprovement > 0.0001);
  return {
    improved,
    regressed,
    verdict: regressed ? 'regression' as const : improved ? 'improvement' as const : 'neutral' as const,
    werImprovement,
    cerImprovement,
    termRecallImprovement,
    reason: regressed
      ? 'לפחות מדד איכות אחד הורע לעומת ריצת הבסיס'
      : improved
        ? `נמצא שיפור ללא הרעה במדדי WER ו-CER${hasTermRecall ? ' וזכירת מונחים' : ''}`
        : 'לא נמצא שינוי מדיד מול ריצת הבסיס',
  };
}
