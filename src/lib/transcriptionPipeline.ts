import { computeCER, computeOrthographicCER, computeOrthographicWER, computeTermRecall, computeWER, lenRatio } from '@/lib/asrMetrics';
import { recordRun } from '@/lib/comparisonRuns';
import { getServerUrl } from '@/lib/serverConfig';
import { applyTranscriptionKnowledge } from '@/lib/transcriptionKnowledge';
import { buildTranscriptionHotwords } from '@/lib/transcriptionHotwords';
import { getLoshonKodeshPrompt } from '@/lib/loshonKodesh';
import { fingerprintFile } from '@/lib/recordingFingerprint';
import { runCloudRetranscription, type RetranscriptionResult, type TranscriptionEngineId } from '@/lib/retranscriptionRunner';
import { logPipelineEvent, type PipelineAuditEvent } from '@/lib/pipelineAudit';
import { getAllTerms } from '@/utils/customVocabulary';

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
  manualHotwords?: string;
  signal?: AbortSignal;
  onProgress?: (progress: number, status: string) => void;
  onEvent?: (event: PipelineAuditEvent) => void;
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
  const response = await fetch(`${getServerUrl()}/transcribe`, { method: 'POST', body: form, signal: options.signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.detail || `שגיאת שרת ${response.status}`);
  const text = String(payload.text || payload.transcript || '').trim();
  if (!text) throw new Error('השרת המקומי לא החזיר תמלול');
  options.onProgress?.(85, 'התמלול המקומי הסתיים');
  return {
    text,
    wordTimings: payload.wordTimings || payload.word_timings || [],
    engine: 'local-server',
    engineLabel: `Local CUDA (${options.model || payload.model || 'default'})`,
    detectedLanguage: payload.language,
    model: options.model || payload.model,
  };
}

function calculateMetrics(reference: string, hypothesis: string): PipelineMetrics {
  const terms = getAllTerms().filter((entry) => entry.approvalStatus === 'verified').map((entry) => entry.term);
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
  const fingerprint = await fingerprintFile(options.file);
  const started = performance.now();
  await emit(options, fingerprint, 'source', 'success', 'source-ready', 'קובץ המקור זוהה ונחתם', {
    fileName: options.file.name,
    fileSize: options.file.size,
    fileType: options.file.type,
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
    hotwordsCount: hotwords ? hotwords.split(',').filter(Boolean).length : 0,
    hasGroundTruth: Boolean(options.groundTruth?.trim()),
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
      ? applyTranscriptionKnowledge(rawText, transcription.engineLabel)
      : { text: rawText, totalApplied: 0, counts: {} };
    await emit(options, fingerprint, 'knowledge', 'success', 'knowledge-applied', options.useKnowledge ? 'צינור הידע הופעל פעם אחת' : 'ריצת בסיס ללא צינור ידע', {
      totalApplied: knowledge.totalApplied,
      counts: knowledge.counts,
    });

    const text = knowledge.text.trim();
    const metrics = options.groundTruth?.trim() ? calculateMetrics(options.groundTruth.trim(), text) : undefined;
    if (metrics) {
      await emit(options, fingerprint, 'metrics', 'success', 'metrics-calculated', 'מדדי האיכות חושבו מול טקסט האמת', metrics as unknown as Record<string, unknown>);
    } else {
      await emit(options, fingerprint, 'metrics', 'warning', 'metrics-skipped', 'לא הוגדר טקסט אמת ולכן לא חושבו WER ו-CER');
    }

    const elapsedMs = Math.round(performance.now() - started);
    const cloudRun = await recordRun({
      kind: 'asr_ground_truth',
      recording_fingerprint: fingerprint,
      recording_label: options.file.name,
      engine: transcription.engineLabel,
      model: transcription.model || options.model || null,
      config_snapshot: {
        experimentId: options.experimentId,
        variant: options.variant,
        useKnowledge: options.useKnowledge,
        loshonKodesh: options.loshonKodesh,
        hotwordsCount: hotwords ? hotwords.split(',').filter(Boolean).length : 0,
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
