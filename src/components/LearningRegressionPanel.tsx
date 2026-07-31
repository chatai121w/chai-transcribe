import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { evaluateLearningRegression, type LearningRegressionResult, type LearningWordStatus } from '@/lib/learningRegression';
import { getServerUrl } from '@/lib/serverConfig';
import { fingerprintFile } from '@/lib/recordingFingerprint';
import { recordRun } from '@/lib/comparisonRuns';
import { applyLearnedCorrections, getLearnedHotwords } from '@/utils/correctionLearning';
import { applyVocabularyCorrections, getHotwordsString, isCustomVocabularyEnabled } from '@/utils/customVocabulary';
import { applyDefinitiveRulesToText, areDefinitiveRulesEnabled } from '@/utils/hebrewRuleEngine';
import { isPersonalPronunciationEnabled } from '@/lib/personalPronunciationModel';
import { applyProfileCorrections, buildProfileHotwords, getProfileInitialPrompt, isProfileLoshonKodesh } from '@/lib/pronunciationProfiles';
import { applyLoshonKodeshReplacements, buildLoshonKodeshHotwords, getLoshonKodeshPrompt, isLoshonKodeshEnabled } from '@/lib/loshonKodesh';

const GROUND_TRUTH_KEY = 'learning_regression_ground_truth_v1';
const HISTORY_KEY = 'learning_regression_history_v1';

interface SavedGroundTruth { key: string; text: string; savedAt: string }
interface SavedRun {
  id: string;
  recordingKey: string;
  createdAt: string;
  model: string;
  baselineText: string;
  candidateText: string;
  groundTruth: string;
  result: LearningRegressionResult;
}

interface LearningRegressionPanelProps {
  audioBlob: Blob | null;
  audioFileName: string;
  currentText: string;
  recordingKey: string;
  onCandidateReady?: (text: string, label: string) => void;
}

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || '') as T; } catch { return fallback; }
}

function pct(value: number): string { return `${(value * 100).toFixed(1)}%`; }

async function transcribe(file: File, learning: boolean): Promise<{ text: string; elapsedMs: number }> {
  const form = new FormData();
  form.append('file', file, file.name);
  form.append('language', 'he');
  const model = localStorage.getItem('preferred_local_model');
  if (model) form.append('model', model);

  if (learning) {
    const personal = isPersonalPronunciationEnabled();
    const vocabulary = isCustomVocabularyEnabled();
    const lkActive = isLoshonKodeshEnabled() || isProfileLoshonKodesh();
    const baseHotwords = [
      vocabulary ? getHotwordsString() : '',
      personal ? getLearnedHotwords() : '',
      personal ? buildProfileHotwords() : '',
    ].filter(Boolean).join(', ');
    const hotwords = lkActive ? buildLoshonKodeshHotwords(baseHotwords) : baseHotwords;
    const prompt = lkActive ? getLoshonKodeshPrompt() : getProfileInitialPrompt();
    if (hotwords) form.append('hotwords', hotwords);
    if (prompt) form.append('initial_prompt', prompt);
    if (lkActive) form.append('loshon_kodesh', '1');
  }

  const started = performance.now();
  const response = await fetch(`${getServerUrl()}/transcribe`, { method: 'POST', body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.detail || `שגיאת שרת ${response.status}`);
  const raw = String(payload.text || payload.transcript || '');
  if (!raw.trim()) throw new Error('השרת לא החזיר תמלול');
  return { text: raw, elapsedMs: Math.round(performance.now() - started) };
}

function applyLearningStack(raw: string): { text: string; corrections: number } {
  let text = raw;
  let corrections = 0;
  if (areDefinitiveRulesEnabled()) {
    const result = applyDefinitiveRulesToText(text);
    text = result.fixedText;
    corrections += result.hits.length;
  }
  if (isPersonalPronunciationEnabled()) {
    const learned = applyLearnedCorrections(text, { engine: 'Local CUDA' });
    text = learned.text;
    corrections += learned.appliedCount;
    const profile = applyProfileCorrections(text);
    text = profile.text;
    corrections += profile.appliedCount;
  }
  if (isCustomVocabularyEnabled()) {
    const vocabulary = applyVocabularyCorrections(text);
    text = vocabulary.text;
    corrections += vocabulary.appliedCount;
  }
  if (isLoshonKodeshEnabled() || isProfileLoshonKodesh()) text = applyLoshonKodeshReplacements(text);
  return { text, corrections };
}

const statusClass: Record<LearningWordStatus, string> = {
  improved: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  regression: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200',
  'still-wrong': 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  'stable-correct': 'border-border bg-muted/40 text-foreground',
};

export function LearningRegressionPanel({ audioBlob, audioFileName, currentText, recordingKey, onCandidateReady }: LearningRegressionPanelProps) {
  const [groundTruth, setGroundTruth] = useState('');
  const [running, setRunning] = useState(false);
  const [latest, setLatest] = useState<SavedRun | null>(null);

  useEffect(() => {
    const saved = readJson<SavedGroundTruth[]>(GROUND_TRUTH_KEY, []).find((item) => item.key === recordingKey);
    setGroundTruth(saved?.text || '');
    const run = readJson<SavedRun[]>(HISTORY_KEY, []).find((item) => item.recordingKey === recordingKey);
    setLatest(run || null);
  }, [recordingKey]);

  const changedWords = useMemo(() => latest?.result.words.filter((word) => word.status !== 'stable-correct') || [], [latest]);

  const saveGroundTruth = () => {
    if (!currentText.trim()) return;
    const all = readJson<SavedGroundTruth[]>(GROUND_TRUTH_KEY, []).filter((item) => item.key !== recordingKey);
    const saved = { key: recordingKey, text: currentText, savedAt: new Date().toISOString() };
    localStorage.setItem(GROUND_TRUTH_KEY, JSON.stringify([saved, ...all].slice(0, 50)));
    setGroundTruth(currentText);
    toast({ title: 'טקסט האמת נשמר', description: 'התמלול הבא יימדד מול הגרסה המתוקנת הזו.' });
  };

  const runCheck = async () => {
    if (!audioBlob || !groundTruth.trim() || running) return;
    setRunning(true);
    try {
      const file = new File([audioBlob], audioFileName || 'recording.wav', { type: audioBlob.type || 'audio/wav' });
      const model = localStorage.getItem('preferred_local_model') || 'local-default';
      const baseline = await transcribe(file, false);
      const candidateRaw = await transcribe(file, true);
      const candidate = applyLearningStack(candidateRaw.text);
      const result = evaluateLearningRegression(groundTruth, baseline.text, candidate.text);
      const saved: SavedRun = {
        id: crypto.randomUUID(), recordingKey, createdAt: new Date().toISOString(), model,
        baselineText: baseline.text, candidateText: candidate.text, groundTruth, result,
      };
      const history = readJson<SavedRun[]>(HISTORY_KEY, []);
      localStorage.setItem(HISTORY_KEY, JSON.stringify([saved, ...history].slice(0, 30)));
      setLatest(saved);

      const fingerprint = await fingerprintFile(file);
      const pairId = saved.id;
      const common = { kind: 'asr_ground_truth' as const, recording_fingerprint: fingerprint, recording_label: file.name, engine: 'Local CUDA', model, reference_text: groundTruth };
      const baselineCloud = await recordRun({ ...common, hypothesis_text: baseline.text, wer: result.baseline.wer, cer: result.baseline.cer, elapsed_ms: baseline.elapsedMs, config_snapshot: { learning: false, pairId } });
      await recordRun({ ...common, hypothesis_text: candidate.text, wer: result.candidate.wer, cer: result.candidate.cer, elapsed_ms: candidateRaw.elapsedMs, corrections_count: candidate.corrections, source_run_id: baselineCloud?.id || null, config_snapshot: { learning: true, pairId, improved: result.improved, regressions: result.regressions, netImprovement: result.netImprovement } });
      toast({
        title: result.regressions ? 'הבדיקה הסתיימה עם רגרסיות' : 'בדיקת הלמידה הסתיימה',
        description: `${result.improved} שיפורים, ${result.regressions} רגרסיות, שינוי WER: ${pct(result.netImprovement)}`,
        variant: result.regressions ? 'destructive' : 'default',
      });
    } catch (error) {
      toast({ title: 'בדיקת הלמידה נכשלה', description: error instanceof Error ? error.message : 'שגיאה לא ידועה', variant: 'destructive' });
    } finally { setRunning(false); }
  };

  return (
    <section dir="rtl" className="w-full rounded-lg border border-border bg-card/60 px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold"><FlaskConical className="h-4 w-4 text-primary" />הוכחת למידה על אותו קובץ</h3>
          <p className="mt-1 text-sm text-muted-foreground">A ללא למידה מול B עם אוצר מילים, תיקונים נלמדים וכללי לשון הקודש.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={saveGroundTruth} disabled={!currentText.trim()}><Save className="me-2 h-4 w-4" />אשר כטקסט אמת</Button>
          <Button onClick={runCheck} disabled={!audioBlob || !groundTruth.trim() || running}>
            {running ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Sparkles className="me-2 h-4 w-4" />}
            {running ? 'מתמלל A/B...' : 'תמלל מחדש ובדוק'}
          </Button>
        </div>
      </div>

      {!groundTruth && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">יש לתקן את הטקסט ולאשר אותו כטקסט אמת לפני הבדיקה.</p>}
      {!audioBlob && <p className="mt-2 text-sm text-muted-foreground">אין קובץ שמע שמור עבור התמלול הנוכחי.</p>}

      {latest && (
        <div className="mt-4 border-t border-border pt-4">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Metric label="WER ללא למידה" value={pct(latest.result.baseline.wer)} />
            <Metric label="WER עם למידה" value={pct(latest.result.candidate.wer)} />
            <Metric label="שיפור נטו" value={pct(latest.result.netImprovement)} good={latest.result.netImprovement > 0} bad={latest.result.netImprovement < 0} />
            <Metric label="מילים שהשתפרו" value={String(latest.result.improved)} good={latest.result.improved > 0} />
            <Metric label="רגרסיות" value={String(latest.result.regressions)} bad={latest.result.regressions > 0} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className={statusClass.improved}>השתפר</Badge>
            <Badge variant="outline" className={statusClass.regression}>רגרסיה</Badge>
            <Badge variant="outline" className={statusClass['still-wrong']}>עדיין שגוי</Badge>
            <span className="text-muted-foreground">לחיצה/ריחוף מציגים אמת, A ו-B.</span>
          </div>
          {latest.result.regressions > 0 && <div className="mt-3 flex items-center gap-2 text-sm text-red-700 dark:text-red-300"><AlertTriangle className="h-4 w-4" />הבדיקה זיהתה מילים שהיו נכונות ב-A והתקלקלו ב-B.</div>}
          {!latest.result.regressions && latest.result.improved > 0 && <div className="mt-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />נמצא שיפור ללא רגרסיה ברמת המילים.</div>}
          <div className="mt-3 flex flex-wrap gap-1.5 leading-8">
            {changedWords.map((word, index) => (
              <span key={`${word.reference}-${index}`} className={`rounded border px-2 py-1 text-sm ${statusClass[word.status]}`} title={`אמת: ${word.reference} | A: ${word.baseline || 'חסר'} | B: ${word.candidate || 'חסר'}`}>
                {word.candidate || '∅'}
              </span>
            ))}
          </div>
          {onCandidateReady && <Button className="mt-3" size="sm" variant="outline" onClick={() => onCandidateReady(latest.candidateText, `בדיקת למידה ${new Date(latest.createdAt).toLocaleString('he-IL')}`)}>שמור את B כגרסה</Button>}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return <div className="border-s border-border px-3 py-1"><div className="text-xs text-muted-foreground">{label}</div><div className={`mt-1 text-lg font-semibold ${good ? 'text-emerald-600' : bad ? 'text-red-600' : ''}`}>{value}</div></div>;
}
