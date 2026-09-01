import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  CircleAlert,
  CloudDownload,
  Database,
  Download,
  FileAudio,
  FlaskConical,
  Loader2,
  Play,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useCustomVocabulary } from '@/hooks/useCustomVocabulary';
import { addApprovedLoraPair } from '@/hooks/useLoraTraining';
import { extractCorrectionCandidates, wordDiff } from '@/lib/asrMetrics';
import { buildApprovedAsrMetadata } from '@/lib/asrDatasetMetadata';
import { importLegacyLkDictionary } from '@/lib/legacyLkMigration';
import { listPipelineEvents, logPipelineEvent, type PipelineAuditEvent } from '@/lib/pipelineAudit';
import { TRANSCRIPTION_ENGINE_OPTIONS, type TranscriptionEngineId } from '@/lib/retranscriptionRunner';
import { normalizeVocabularyKey } from '@/utils/customVocabulary';
import {
  comparePipelineResults,
  runTranscriptionPipeline,
  type PipelineRunResult,
} from '@/lib/transcriptionPipeline';

const VocabularyPanel = lazy(() => import('@/components/VocabularyPanel').then((module) => ({ default: module.VocabularyPanel })));
const LoraFineTuningPanel = lazy(() => import('@/components/training/LoraFineTuningPanel'));
const ACTIVE_EXPERIMENT_KEY = 'asr_pipeline_active_experiment_v1';

const CUDA_MODELS = [
  { value: 'ivrit-ai/whisper-large-v3-turbo-ct2', label: 'Ivrit.ai Turbo V3' },
  { value: 'ivrit-ai/whisper-large-v3-ct2', label: 'Ivrit.ai Large V3' },
  { value: 'large-v3-turbo', label: 'Whisper Large V3 Turbo' },
  { value: 'large-v3', label: 'Whisper Large V3' },
];

const GEMINI_MODELS = [
  { value: 'gemini-3.5-transcribe', label: 'Gemini 3.5 Transcribe (ייעודי)' },
  { value: 'gemini-flash-latest', label: 'Gemini Flash Latest' },
  { value: 'gemini-pro-latest', label: 'Gemini Pro Latest' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

const PROVIDER_DEFAULT_MODEL = 'provider-default';

function modelsForEngine(engine: TranscriptionEngineId) {
  if (engine === 'local-server') return CUDA_MODELS;
  if (engine === 'gemini') return GEMINI_MODELS;
  return [{ value: PROVIDER_DEFAULT_MODEL, label: 'ברירת המחדל של הספק' }];
}

function defaultModelForEngine(engine: TranscriptionEngineId) {
  return modelsForEngine(engine)[0].value;
}

function resolvedModel(model: string): string | undefined {
  return model === PROVIDER_DEFAULT_MODEL ? undefined : model;
}

const stageLabels: Record<string, string> = {
  source: 'מקור',
  configuration: 'הגדרות',
  upload: 'העלאה',
  transcription: 'תמלול',
  knowledge: 'מילון וכללים',
  metrics: 'מדדים',
  'quality-gate': 'שער איכות',
  review: 'בדיקה אנושית',
  lexicon: 'מילון',
  training: 'אימון',
  complete: 'סיום',
};

function formatMetric(value: number | undefined): string {
  return value == null ? 'לא נמדד' : `${(value * 100).toFixed(2)}%`;
}

function MetricRow({ label, baseline, candidate, lowerIsBetter = true }: { label: string; baseline?: number; candidate?: number; lowerIsBetter?: boolean }) {
  const improved = baseline != null && candidate != null && (lowerIsBetter ? candidate < baseline : candidate > baseline);
  const regressed = baseline != null && candidate != null && (lowerIsBetter ? candidate > baseline : candidate < baseline);
  return (
    <div className="grid grid-cols-[minmax(7rem,1fr)_minmax(5rem,7rem)_minmax(5rem,7rem)] items-center gap-3 border-b py-2 last:border-b-0">
      <span className="font-medium">{label}</span>
      <span className="text-center tabular-nums">{formatMetric(baseline)}</span>
      <span className={`text-center tabular-nums font-semibold ${improved ? 'text-emerald-700' : regressed ? 'text-red-700' : ''}`}>{formatMetric(candidate)}</span>
    </div>
  );
}

export default function TranscriptionLab() {
  const [searchParams] = useSearchParams();
  const initialLk = searchParams.get('mode') === 'lashon-kodesh';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [experimentId, setExperimentId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_EXPERIMENT_KEY) || crypto.randomUUID();
    } catch {
      return crypto.randomUUID();
    }
  });
  const [baselineEngine, setBaselineEngine] = useState<TranscriptionEngineId>('local-server');
  const [candidateEngine, setCandidateEngine] = useState<TranscriptionEngineId>('local-server');
  const [baselineModel, setBaselineModel] = useState('ivrit-ai/whisper-large-v3-turbo-ct2');
  const [candidateModel, setCandidateModel] = useState('ivrit-ai/whisper-large-v3-turbo-ct2');
  const [loshonKodesh, setLoshonKodesh] = useState(initialLk);
  const [manualHotwords, setManualHotwords] = useState('');
  const [groundTruth, setGroundTruth] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('ממתין לקובץ');
  const [baseline, setBaseline] = useState<PipelineRunResult | null>(null);
  const [candidate, setCandidate] = useState<PipelineRunResult | null>(null);
  const [events, setEvents] = useState<PipelineAuditEvent[]>([]);
  const [goldApproved, setGoldApproved] = useState(false);
  const [importingLegacy, setImportingLegacy] = useState(false);
  const vocabulary = useCustomVocabulary();

  useEffect(() => {
    localStorage.setItem(ACTIVE_EXPERIMENT_KEY, experimentId);
    setEvents(listPipelineEvents(experimentId));
    const refresh = () => setEvents(listPipelineEvents(experimentId));
    window.addEventListener('asr-pipeline-event', refresh);
    return () => window.removeEventListener('asr-pipeline-event', refresh);
  }, [experimentId]);

  const comparison = useMemo(
    () => baseline && candidate ? comparePipelineResults(baseline, candidate) : null,
    [baseline, candidate],
  );
  const correctionCandidates = useMemo(() => {
    if (!groundTruth.trim() || !candidate?.text) return [];
    return extractCorrectionCandidates(wordDiff(groundTruth, candidate.text)).slice(0, 50);
  }, [candidate?.text, groundTruth]);

  const handleFile = (next: File | null) => {
    setFile(next);
    const nextExperimentId = crypto.randomUUID();
    localStorage.setItem(ACTIVE_EXPERIMENT_KEY, nextExperimentId);
    setExperimentId(nextExperimentId);
    setBaseline(null);
    setCandidate(null);
    setEvents([]);
    setGoldApproved(false);
    setProgress(0);
    setStatus(next ? 'קובץ המקור מוכן' : 'ממתין לקובץ');
  };

  const appendEvent = (event: PipelineAuditEvent) => setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)]);

  const runExperiment = async () => {
    if (!file || running) return;
    setRunning(true);
    setBaseline(null);
    setCandidate(null);
    setEvents(listPipelineEvents(experimentId));
    setProgress(0);
    setGoldApproved(false);
    abortRef.current = new AbortController();
    try {
      const base = await runTranscriptionPipeline({
        experimentId,
        variant: 'baseline',
        file,
        engine: baselineEngine,
        model: resolvedModel(baselineModel),
        language: 'he',
        groundTruth,
        useKnowledge: false,
        loshonKodesh: false,
        signal: abortRef.current.signal,
        onEvent: appendEvent,
        onProgress: (value, message) => { setProgress(value * 0.48); setStatus(`A: ${message}`); },
      });
      setBaseline(base);

      const enhanced = await runTranscriptionPipeline({
        experimentId,
        variant: 'candidate',
        file,
        engine: candidateEngine,
        model: resolvedModel(candidateModel),
        language: 'he',
        groundTruth,
        useKnowledge: true,
        loshonKodesh,
        manualHotwords,
        signal: abortRef.current.signal,
        onEvent: appendEvent,
        onProgress: (value, message) => { setProgress(50 + value * 0.5); setStatus(`B: ${message}`); },
      });
      setCandidate(enhanced);
      const verdict = comparePipelineResults(base, enhanced);
      const event = await logPipelineEvent({
        experimentId,
        recordingFingerprint: enhanced.recordingFingerprint,
        comparisonRunId: enhanced.comparisonRunId,
        stage: 'quality-gate',
        level: verdict?.regressed ? 'error' : verdict?.improved ? 'success' : 'warning',
        eventType: verdict?.verdict || 'not-measured',
        message: verdict?.reason || 'אין טקסט אמת ולכן לא ניתן לקבוע שיפור או רגרסיה',
        details: verdict || { hasGroundTruth: false },
      });
      appendEvent(event);
      const reviewEvent = await logPipelineEvent({
        experimentId,
        recordingFingerprint: enhanced.recordingFingerprint,
        comparisonRunId: enhanced.comparisonRunId,
        stage: 'review',
        level: groundTruth.trim() ? 'info' : 'warning',
        eventType: groundTruth.trim() ? 'review-ready' : 'review-needs-ground-truth',
        message: groundTruth.trim() ? 'תוצאות A/B מוכנות לבדיקה אנושית' : 'נדרש טקסט אמת כדי להפיק מועמדי תיקון',
        details: {
          correctionCandidates: groundTruth.trim()
            ? extractCorrectionCandidates(wordDiff(groundTruth.trim(), enhanced.text)).length
            : 0,
          reason: 'שינוי במילון או במאגר Gold חייב אישור אנושי',
        },
      });
      appendEvent(reviewEvent);
      setProgress(100);
      setStatus('הניסוי הושלם');
      toast({
        title: verdict?.regressed ? 'נמצאה רגרסיה' : verdict?.improved ? 'נמצא שיפור' : 'ההשוואה הסתיימה',
        description: verdict?.reason || 'כדי למדוד שיפור יש להוסיף טקסט אמת',
        variant: verdict?.regressed ? 'destructive' : 'default',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') setStatus('הניסוי נעצר');
      else {
        setStatus('הניסוי נכשל');
        toast({ title: 'הניסוי נכשל', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const addCorrectionToLexicon = async (wrong: string, correct: string) => {
    const normalizedCorrect = correct.trim();
    const normalizedWrong = wrong.trim();
    if (!normalizedCorrect || !normalizedWrong) return;
    const correctKey = normalizeVocabularyKey(normalizedCorrect);
    const wrongKey = normalizeVocabularyKey(normalizedWrong);
    const existing = vocabulary.entries.find((entry) => normalizeVocabularyKey(entry.term) === correctKey);
    const saved = existing
      ? vocabulary.update(existing.term, {
          variants: existing.variants.some((variant) => normalizeVocabularyKey(variant) === wrongKey)
            ? existing.variants
            : [...existing.variants, normalizedWrong],
          approvalStatus: 'candidate',
        })
      : vocabulary.add(normalizedCorrect, 'other', [normalizedWrong], {
          source: 'approved-correction',
          approvalStatus: 'candidate',
          confidence: 0.6,
          contextTags: ['ניסוי תמלול'],
        });
    if (!saved) return;
    const event = await logPipelineEvent({
      experimentId,
      recordingFingerprint: candidate?.recordingFingerprint,
      stage: 'lexicon',
      level: 'success',
      eventType: 'candidate-added',
      message: 'תיקון נוסף כמועמד למילון המרכזי',
      details: { wrong: normalizedWrong, correct: normalizedCorrect },
    });
    appendEvent(event);
    toast({ title: 'נוסף כמועמד למילון', description: `${normalizedWrong} ← ${normalizedCorrect}` });
  };

  const approveGold = async () => {
    if (!file || !groundTruth.trim() || !candidate) return;
    try {
      const result = await addApprovedLoraPair(file, groundTruth.trim(), 'approved-ground-truth', buildApprovedAsrMetadata({
        recordingFingerprint: candidate.recordingFingerprint,
        sourceKind: 'transcription-lab',
        sourceRef: file.name,
        sourceLabel: file.name,
        teacherEngines: [baseline?.engineLabel, candidate.engineLabel].filter(Boolean) as string[],
      }));
      setGoldApproved(true);
      const event = await logPipelineEvent({
        experimentId,
        recordingFingerprint: candidate.recordingFingerprint,
        stage: 'training',
        level: 'success',
        eventType: 'gold-approved',
        message: 'האודיו וטקסט האמת אושרו למאגר Gold',
        details: { rows: result.rows, fileName: file.name },
      });
      appendEvent(event);
      toast({ title: 'נוסף למאגר Gold', description: `${result.rows} קטעים מאושרים במאגר` });
    } catch (error) {
      toast({ title: 'האישור נכשל', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    }
  };

  const importLegacy = async () => {
    setImportingLegacy(true);
    try {
      const result = await importLegacyLkDictionary(experimentId);
      await vocabulary.syncCloud();
      setEvents(listPipelineEvents(experimentId));
      toast({ title: 'הייבוא הסתיים', description: `${result.imported} רשומות אוחדו כמועמדות לבדיקה` });
    } catch (error) {
      toast({ title: 'הייבוא נכשל', description: error instanceof Error ? error.message : String(error), variant: 'destructive' });
    } finally {
      setImportingLegacy(false);
    }
  };

  const downloadEvents = () => {
    const data = JSON.stringify(listPipelineEvents(experimentId), null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `asr-pipeline-${experimentId.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main dir="rtl" className="mx-auto w-full max-w-7xl px-4 py-6 text-right md:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><FlaskConical className="h-7 w-7" />מעבדת תמלול מתקדמת</h1>
          <p className="mt-1 text-sm text-muted-foreground">צינור אחד לתמלול A/B, לשון הקודש, בדיקה אנושית, מילון, מדידת שיפור ואימון.</p>
        </div>
        <Badge variant="outline" className="font-mono text-xs">{experimentId.slice(0, 8)}</Badge>
      </header>

      <div className="mb-6 border-y bg-muted/20 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="font-medium">{status}</span><span className="tabular-nums">{Math.round(progress)}%</span></div>
        <Progress value={progress} className="h-2" />
      </div>

      <Accordion type="multiple" defaultValue={['source', 'configuration', 'run', 'compare', 'logs']} className="w-full">
        <AccordionItem value="source">
          <AccordionTrigger className="text-right hover:no-underline"><span className="flex items-center gap-3"><Badge>1</Badge><FileAudio className="h-5 w-5" />מקור וטקסט אמת</span></AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[minmax(16rem,0.8fr)_minmax(20rem,1.2fr)]">
              <div className="space-y-2">
                <Label htmlFor="lab-audio">קובץ האודיו המקורי</Label>
                <div className="flex gap-2">
                  <Input id="lab-audio" ref={fileInputRef} type="file" accept="audio/*,video/*" onChange={(event) => handleFile(event.target.files?.[0] || null)} />
                </div>
                {file && <p className="text-xs text-muted-foreground">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ground-truth">טקסט אמת מאושר</Label>
                <Textarea id="ground-truth" value={groundTruth} onChange={(event) => setGroundTruth(event.target.value)} rows={5} dir="rtl" placeholder="הדבק כאן תמלול שנבדק מול האודיו. בלי טקסט אמת תתבצע השוואה חזותית בלבד." />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="configuration">
          <AccordionTrigger className="text-right hover:no-underline"><span className="flex items-center gap-3"><Badge>2</Badge><Settings2 className="h-5 w-5" />הגדרות הניסוי</span></AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2"><Label>מנוע A - בסיס</Label><Select value={baselineEngine} onValueChange={(value) => { const next = value as TranscriptionEngineId; setBaselineEngine(next); setBaselineModel(defaultModelForEngine(next)); }}><SelectTrigger aria-label="מנוע A - בסיס"><SelectValue /></SelectTrigger><SelectContent>{TRANSCRIPTION_ENGINE_OPTIONS.filter((option) => option.id !== 'local').map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>מודל A</Label><Select value={baselineModel} onValueChange={setBaselineModel}><SelectTrigger aria-label="מודל A"><SelectValue /></SelectTrigger><SelectContent>{modelsForEngine(baselineEngine).map((model) => <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>מנוע B - מועמד</Label><Select value={candidateEngine} onValueChange={(value) => { const next = value as TranscriptionEngineId; setCandidateEngine(next); setCandidateModel(defaultModelForEngine(next)); }}><SelectTrigger aria-label="מנוע B - מועמד"><SelectValue /></SelectTrigger><SelectContent>{TRANSCRIPTION_ENGINE_OPTIONS.filter((option) => option.id !== 'local').map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>מודל B</Label><Select value={candidateModel} onValueChange={setCandidateModel}><SelectTrigger aria-label="מודל B"><SelectValue /></SelectTrigger><SelectContent>{modelsForEngine(candidateEngine).map((model) => <SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <div className="flex flex-wrap items-center gap-5 border-y py-3">
              <label className="flex items-center gap-2"><Checkbox checked={loshonKodesh} onCheckedChange={(value) => setLoshonKodesh(Boolean(value))} />הפעל מצב לשון הקודש בריצה B</label>
              <Badge variant="outline">A ללא מילון וכללים</Badge>
              <Badge variant="secondary">B עם צינור הידע המרכזי</Badge>
            </div>
            <div className="space-y-2"><Label htmlFor="manual-hotwords">מונחים מיוחדים להקלטה זו</Label><Input id="manual-hotwords" value={manualHotwords} onChange={(event) => setManualHotwords(event.target.value)} dir="rtl" placeholder="מונחים מופרדים בפסיקים" /></div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="run">
          <AccordionTrigger className="text-right hover:no-underline"><span className="flex items-center gap-3"><Badge>3</Badge><Play className="h-5 w-5" />הרצת A/B</span></AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void runExperiment()} disabled={!file || running}>{running ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Play className="me-2 h-4 w-4" />}{running ? 'מריץ את שתי הגרסאות...' : 'הפעל ניסוי מלא'}</Button>
              {running && <Button variant="outline" onClick={() => abortRef.current?.abort()}>עצור</Button>}
              <span className="text-sm text-muted-foreground">הקובץ נשאר זהה; רק המודל וצינור הידע משתנים.</span>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="compare">
          <AccordionTrigger className="text-right hover:no-underline"><span className="flex items-center gap-3"><Badge>4</Badge><BarChart3 className="h-5 w-5" />השוואה ושער איכות</span></AccordionTrigger>
          <AccordionContent className="space-y-5">
            {!baseline || !candidate ? <p className="text-sm text-muted-foreground">התוצאות יוצגו לאחר השלמת שתי הריצות.</p> : <>
              <div className={`flex items-center gap-3 border-y px-3 py-3 ${comparison?.regressed ? 'bg-red-50 text-red-900' : comparison?.improved ? 'bg-emerald-50 text-emerald-900' : 'bg-muted/30'}`}>
                {comparison?.regressed ? <CircleAlert className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
                <div><div className="font-semibold">{comparison?.regressed ? 'נמצאה רגרסיה' : comparison?.improved ? 'נמצא שיפור' : 'אין הכרעה מדידה'}</div><div className="text-sm">{comparison?.reason || 'יש להוסיף טקסט אמת כדי להפעיל את שער האיכות.'}</div></div>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <section><h3 className="mb-2 font-semibold">A · בסיס · {baseline.engineLabel}</h3><Textarea readOnly value={baseline.text} rows={12} dir="rtl" /></section>
                <section><h3 className="mb-2 font-semibold">B · מועמד · {candidate.engineLabel}</h3><Textarea readOnly value={candidate.text} rows={12} dir="rtl" /></section>
              </div>
              <section className="border-y py-3">
                <div className="grid grid-cols-[minmax(7rem,1fr)_minmax(5rem,7rem)_minmax(5rem,7rem)] gap-3 border-b pb-2 text-xs text-muted-foreground"><span>מדד</span><span className="text-center">A</span><span className="text-center">B</span></div>
                <MetricRow label="WER" baseline={baseline.metrics?.wer} candidate={candidate.metrics?.wer} />
                <MetricRow label="CER" baseline={baseline.metrics?.cer} candidate={candidate.metrics?.cer} />
                <MetricRow label="WER מנורמל" baseline={baseline.metrics?.orthographicWer} candidate={candidate.metrics?.orthographicWer} />
                <MetricRow label="זכירת מונחים" baseline={baseline.metrics?.termRecall} candidate={candidate.metrics?.termRecall} lowerIsBetter={false} />
              </section>
            </>}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="review">
          <AccordionTrigger className="text-right hover:no-underline"><span className="flex items-center gap-3"><Badge>5</Badge><ShieldCheck className="h-5 w-5" />בדיקה אנושית ומועמדים למילון</span></AccordionTrigger>
          <AccordionContent className="space-y-3">
            {!correctionCandidates.length ? <p className="text-sm text-muted-foreground">מועמדים יוצגו לאחר השוואת תוצאת B לטקסט אמת.</p> : correctionCandidates.map((item, index) => (
              <div key={`${item.wrong}-${item.correct}-${index}`} className="flex flex-wrap items-center gap-3 border-b py-2 last:border-b-0">
                <span className="text-red-700 line-through">{item.wrong || 'חסר'}</span><ChevronLeft className="h-4 w-4" /><span className="font-semibold text-emerald-700">{item.correct || 'מחיקה'}</span>
                <Button size="sm" variant="outline" className="ms-auto" onClick={() => void addCorrectionToLexicon(item.wrong, item.correct)}><BookOpen className="me-1 h-4 w-4" />הוסף כמועמד</Button>
              </div>
            ))}
            <Separator />
            <Button onClick={() => void approveGold()} disabled={!file || !groundTruth.trim() || !candidate || goldApproved}>{goldApproved ? <CheckCircle2 className="me-2 h-4 w-4" /> : <Save className="me-2 h-4 w-4" />}{goldApproved ? 'אושר למאגר Gold' : 'אשר אודיו וטקסט אמת ל-Gold'}</Button>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="lexicon">
          <AccordionTrigger className="text-right hover:no-underline"><span className="flex items-center gap-3"><Badge>6</Badge><Database className="h-5 w-5" />המילון המרכזי</span></AccordionTrigger>
          <AccordionContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 border-b pb-3"><Button variant="outline" onClick={() => void importLegacy()} disabled={importingLegacy}>{importingLegacy ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <CloudDownload className="me-2 h-4 w-4" />}ייבא מילון LK ישן כמועמדים</Button><span className="text-xs text-muted-foreground">הייבוא אינו מוחק את המאגר הישן ואינו מפעיל תיקונים בלי אישור.</span></div>
            <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin" />}><VocabularyPanel /></Suspense>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="training">
          <AccordionTrigger className="text-right hover:no-underline"><span className="flex items-center gap-3"><Badge>7</Badge><Sparkles className="h-5 w-5" />מאגר Gold ואימון LoRA</span></AccordionTrigger>
          <AccordionContent><Suspense fallback={<Loader2 className="h-5 w-5 animate-spin" />}><LoraFineTuningPanel /></Suspense></AccordionContent>
        </AccordionItem>

        <AccordionItem value="logs">
          <AccordionTrigger className="text-right hover:no-underline"><span className="flex items-center gap-3"><Badge>8</Badge><Activity className="h-5 w-5" />יומן פיתוח ומעקב</span></AccordionTrigger>
          <AccordionContent>
            <div className="mb-3 flex items-center justify-between gap-3"><span className="text-sm text-muted-foreground">{events.length} אירועים בריצה זו</span><div className="flex gap-1"><Button size="icon" variant="ghost" onClick={downloadEvents} disabled={!events.length} title="הורד יומן JSON" aria-label="הורד יומן JSON"><Download className="h-4 w-4" /></Button><Button size="sm" variant="ghost" onClick={() => setEvents(listPipelineEvents(experimentId))}>רענן</Button></div></div>
            <div className="max-h-[32rem] overflow-y-auto border-y">
              {!events.length ? <p className="p-4 text-sm text-muted-foreground">היומן יתמלא בזמן ההרצה.</p> : events.map((event) => (
                <div key={event.id} className="grid gap-2 border-b px-3 py-3 last:border-b-0 md:grid-cols-[7rem_8rem_minmax(0,1fr)_9rem]">
                  <Badge variant={event.level === 'error' ? 'destructive' : event.level === 'success' ? 'default' : 'outline'} className="w-fit">{{ info: 'מידע', success: 'הצלחה', warning: 'אזהרה', error: 'כשל' }[event.level]}</Badge>
                  <span className="text-xs font-medium">{stageLabels[event.stage] || event.stage}</span>
                  <div className="min-w-0"><div className="text-sm font-medium">{event.message}</div><pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{JSON.stringify(event.details, null, 2)}</pre></div>
                  <time className="text-xs text-muted-foreground" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString('he-IL')}</time>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </main>
  );
}
