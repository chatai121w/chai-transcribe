/**
 * ASR Training Page — אימון אוטומטי לתמלול
 *
 * Upload audio → fetch canonical Hebrew text (Sefaria / free text) →
 * transcribe with one or two engines → compute WER/CER/term-recall →
 * extract word diff → save run + (auto/hybrid/manual) feed corrections.
 *
 * No new colors. Reuses existing shadcn tokens and theme.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Upload, Sparkles, BookOpen, Trash2, Check, X, RefreshCw } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { normalizeHebrew } from '@/lib/hebrewNormalize';
import {
  computeWER, computeCER, computeTermRecall, lenRatio,
  wordDiff, extractCorrectionCandidates, isAmbiguous, type DiffOp,
} from '@/lib/asrMetrics';
import { learnFromCorrections, type CorrectionEntry } from '@/utils/correctionLearning';

// ─── Tanakh book catalog (Sefaria refs) ───────────────────────────────────
const TANAKH_BOOKS: Array<{ value: string; label: string; chapters: number }> = [
  { value: 'Genesis',     label: 'בראשית',  chapters: 50 },
  { value: 'Exodus',      label: 'שמות',    chapters: 40 },
  { value: 'Leviticus',   label: 'ויקרא',   chapters: 27 },
  { value: 'Numbers',     label: 'במדבר',   chapters: 36 },
  { value: 'Deuteronomy', label: 'דברים',   chapters: 34 },
  { value: 'Psalms',      label: 'תהילים',  chapters: 150 },
  { value: 'Proverbs',    label: 'משלי',    chapters: 31 },
  { value: 'Job',         label: 'איוב',    chapters: 42 },
  { value: 'Song of Songs', label: 'שיר השירים', chapters: 8 },
  { value: 'Ruth',        label: 'רות',     chapters: 4 },
  { value: 'Lamentations', label: 'איכה',   chapters: 5 },
  { value: 'Ecclesiastes', label: 'קהלת',   chapters: 12 },
  { value: 'Esther',      label: 'אסתר',    chapters: 10 },
  { value: 'Isaiah',      label: 'ישעיהו',  chapters: 66 },
  { value: 'Jeremiah',    label: 'ירמיהו',  chapters: 52 },
  { value: 'Ezekiel',     label: 'יחזקאל',  chapters: 48 },
];

// Default seed of Hebrew target terms (subset of tools/asr_eval/target_terms.txt)
const DEFAULT_TARGET_TERMS = [
  'רבא','אביי','רב אשי','רב פפא','רב הונא','רב יהודה','רב נחמן','רב חסדא',
  'רבי יוחנן','ריש לקיש','שמואל','רבי עקיבא','רבי מאיר','רבן גמליאל','הלל','שמאי',
  'קאמר','תנו רבנן','תניא','מתניתין','גמרא','מאי טעמא','תא שמע','קא משמע לן',
  'דאמר מר','איבעיא להו','פשיטא','מנא הני מילי','קושיא','תירוץ','דתניא','מיתיבי',
  'משנה','ברייתא','הלכה','איסור','היתר','טמא','טהור','חייב','פטור','מצווה',
];

type Engine = 'lovable' | 'local';
type LearningMode = 'auto' | 'hybrid' | 'manual';

interface RunMetrics {
  wer: number; cer: number; termRecall: number; lenRatio: number;
  sub: number; ins: number; del: number; elapsedMs: number;
}

interface EngineResult {
  engine: Engine;
  model: string;
  hyp: string;
  metrics: RunMetrics;
  diff: DiffOp[];
  candidates: Array<{ wrong: string; correct: string }>;
}

interface SavedRun {
  id: string;
  source_label: string | null;
  source_ref: string | null;
  model_a: string | null;
  model_b: string | null;
  wer_a: number | null;
  wer_b: number | null;
  cer_a: number | null;
  cer_b: number | null;
  term_recall_a: number | null;
  term_recall_b: number | null;
  corrections_applied: number;
  created_at: string;
}

interface PendingCorrection {
  id: string;
  wrong_text: string;
  correct_text: string;
  occurrences: number;
  engine: string | null;
  created_at: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function transcribeWithLovable(file: File, model: string): Promise<{ text: string; elapsed_ms: number }> {
  const fd = new FormData();
  fd.append('file', file, file.name || 'audio.webm');
  fd.append('model', model);
  fd.append('language', 'he');
  const { data, error } = await supabase.functions.invoke('transcribe-lovable-stt', { body: fd });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return { text: data.text || '', elapsed_ms: data.elapsed_ms || 0 };
}

async function transcribeWithLocal(file: File, serverUrl: string): Promise<{ text: string; elapsed_ms: number }> {
  const fd = new FormData();
  fd.append('audio', file, file.name || 'audio.wav');
  fd.append('language', 'he');
  const t0 = Date.now();
  const resp = await fetch(`${serverUrl.replace(/\/$/, '')}/transcribe`, { method: 'POST', body: fd });
  if (!resp.ok) throw new Error(`Local server ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return { text: data.text || data.transcript || '', elapsed_ms: Date.now() - t0 };
}

function evaluateRun(ref: string, hyp: string, elapsed_ms: number): { metrics: RunMetrics; diff: DiffOp[]; candidates: Array<{wrong:string;correct:string}> } {
  const w = computeWER(ref, hyp);
  const c = computeCER(ref, hyp);
  const tr = computeTermRecall(ref, hyp, DEFAULT_TARGET_TERMS);
  const lr = lenRatio(ref, hyp);
  const diff = wordDiff(ref, hyp);
  const candidates = extractCorrectionCandidates(diff);
  return {
    metrics: {
      wer: w.wer, cer: c.cer, termRecall: tr.recall || 0, lenRatio: lr,
      sub: w.sub, ins: w.ins, del: w.del, elapsedMs: elapsed_ms,
    },
    diff,
    candidates,
  };
}

function pct(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '—';
  return (x * 100).toFixed(digits) + '%';
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function AsrTraining() {
  const { user } = useAuth();
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [sourceKind, setSourceKind] = useState<'tanakh' | 'text'>('tanakh');
  const [book, setBook] = useState<string>('Psalms');
  const [chapter, setChapter] = useState<string>('1');
  const [verses, setVerses] = useState<string>(''); // e.g. "1-10" optional
  const [freeText, setFreeText] = useState<string>('');
  const [refText, setRefText] = useState<string>('');
  const [refLabel, setRefLabel] = useState<string>('');

  const [useLovable, setUseLovable] = useState(true);
  const [useLocal, setUseLocal] = useState(false);
  const [lovableModel, setLovableModel] = useState('openai/gpt-4o-mini-transcribe');
  const [localServerUrl, setLocalServerUrl] = useState<string>(
    () => localStorage.getItem('asr_training_local_url') || 'http://localhost:3000',
  );
  const [learningMode, setLearningMode] = useState<LearningMode>(
    () => (localStorage.getItem('asr_training_mode') as LearningMode) || 'hybrid',
  );

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<EngineResult[]>([]);
  const [history, setHistory] = useState<SavedRun[]>([]);
  const [pending, setPending] = useState<PendingCorrection[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem('asr_training_mode', learningMode); }, [learningMode]);
  useEffect(() => { localStorage.setItem('asr_training_local_url', localServerUrl); }, [localServerUrl]);

  // Load history + pending corrections
  const refreshLists = async () => {
    if (!user) return;
    const [{ data: runs }, { data: pend }] = await Promise.all([
      supabase.from('asr_training_runs').select('*').order('created_at', { ascending: false }).limit(30),
      supabase.from('asr_pending_corrections').select('*').eq('status', 'pending').order('occurrences', { ascending: false }).limit(100),
    ]);
    if (runs) setHistory(runs as SavedRun[]);
    if (pend) setPending(pend as PendingCorrection[]);
  };
  useEffect(() => { void refreshLists(); }, [user?.id]);

  // ─── Fetch reference text ───
  const fetchReference = async () => {
    if (sourceKind === 'text') {
      const t = freeText.trim();
      if (!t) { toast({ title: 'הכנס טקסט קנוני', variant: 'destructive' }); return; }
      setRefText(t);
      setRefLabel('טקסט חופשי');
      toast({ title: 'טקסט נטען', description: `${t.split(/\s+/).length} מילים` });
      return;
    }
    const ref = verses.trim()
      ? `${book}.${chapter}.${verses.trim()}`
      : `${book}.${chapter}`;
    try {
      const { data, error } = await supabase.functions.invoke('fetch-sefaria-text', { body: { ref } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setRefText(data.text);
      const bookHe = TANAKH_BOOKS.find((b) => b.value === book)?.label || book;
      setRefLabel(`${bookHe} ${chapter}${verses.trim() ? `:${verses}` : ''}`);
      toast({ title: 'טקסט נטען', description: `${data.text.split(/\s+/).length} מילים מ-Sefaria` });
    } catch (err) {
      toast({ title: 'טעינת מקור נכשלה', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    }
  };

  // ─── Run comparison ───
  const runComparison = async () => {
    if (!user) { toast({ title: 'נדרשת התחברות', variant: 'destructive' }); return; }
    if (!audioFile) { toast({ title: 'העלה קובץ אודיו', variant: 'destructive' }); return; }
    let effectiveRef = refText;
    if (!effectiveRef && sourceKind === 'text' && freeText.trim()) {
      effectiveRef = freeText.trim();
      setRefText(effectiveRef);
      setRefLabel('טקסט חופשי');
    }
    if (!effectiveRef) { toast({ title: 'טען טקסט קנוני קודם', variant: 'destructive' }); return; }
    if (!useLovable && !useLocal) { toast({ title: 'בחר לפחות מנוע אחד', variant: 'destructive' }); return; }

    setRunning(true);
    setResults([]);
    const results: EngineResult[] = [];

    try {
      if (useLovable) {
        toast({ title: 'מתמלל עם Lovable AI…' });
        const { text, elapsed_ms } = await transcribeWithLovable(audioFile, lovableModel);
        const { metrics, diff, candidates } = evaluateRun(effectiveRef, text, elapsed_ms);
        results.push({ engine: 'lovable', model: lovableModel, hyp: text, metrics, diff, candidates });
        setResults([...results]);
      }
      if (useLocal) {
        toast({ title: 'מתמלל עם השרת המקומי…' });
        try {
          const { text, elapsed_ms } = await transcribeWithLocal(audioFile, localServerUrl);
          const { metrics, diff, candidates } = evaluateRun(effectiveRef, text, elapsed_ms);
          results.push({ engine: 'local', model: 'ivrit-ai/local-cuda', hyp: text, metrics, diff, candidates });
          setResults([...results]);
        } catch (err) {
          toast({ title: 'שרת מקומי לא זמין', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
        }
      }

      // Save run + handle corrections per learning mode
      await saveRun(results, effectiveRef);
    } catch (err) {
      toast({ title: 'תמלול נכשל', description: err instanceof Error ? err.message : String(err), variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  const saveRun = async (results: EngineResult[]) => {
    if (!user || results.length === 0) return;
    const a = results[0];
    const b = results[1];

    // Auto-applied corrections (per learning mode, based on engine A's diff)
    const autoApplied: CorrectionEntry[] = [];
    const queuedPending: Array<{ wrong: string; correct: string; engine: string }> = [];

    if (a) {
      // Aggregate candidates: count duplicates within this run
      const counts = new Map<string, number>();
      for (const c of a.candidates) {
        if (isAmbiguous(c.wrong, c.correct)) continue;
        const key = `${c.wrong}→${c.correct}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      for (const [key, n] of counts) {
        const [wrong, correct] = key.split('→');
        if (learningMode === 'auto') {
          autoApplied.push(buildCorrection(wrong, correct, n, a.engine));
        } else if (learningMode === 'hybrid') {
          if (n >= 2) autoApplied.push(buildCorrection(wrong, correct, n, a.engine));
          else queuedPending.push({ wrong, correct, engine: a.engine });
        } else {
          queuedPending.push({ wrong, correct, engine: a.engine });
        }
      }
    }

    // Persist corrections to local learning store
    if (autoApplied.length > 0) learnFromCorrections(autoApplied);

    // Persist run
    const { data: insertedRun, error: runErr } = await supabase
      .from('asr_training_runs')
      .insert({
        user_id: user.id,
        source_kind: sourceKind,
        source_ref: sourceKind === 'tanakh' ? `${book}.${chapter}${verses.trim() ? `.${verses.trim()}` : ''}` : null,
        source_label: refLabel,
        ref_text: refText,
        hyp_a_text: a?.hyp ?? null,
        model_a: a?.model ?? null,
        wer_a: a?.metrics.wer ?? null,
        cer_a: a?.metrics.cer ?? null,
        term_recall_a: a?.metrics.termRecall ?? null,
        hyp_b_text: b?.hyp ?? null,
        model_b: b?.model ?? null,
        wer_b: b?.metrics.wer ?? null,
        cer_b: b?.metrics.cer ?? null,
        term_recall_b: b?.metrics.termRecall ?? null,
        audio_duration_ms: 0,
        audio_filename: audioFile?.name ?? null,
        learning_mode: learningMode,
        corrections_applied: autoApplied.length,
      })
      .select()
      .single();

    if (runErr) { toast({ title: 'שמירה נכשלה', description: runErr.message, variant: 'destructive' }); return; }

    // Persist pending corrections
    if (queuedPending.length > 0 && insertedRun) {
      await supabase.from('asr_pending_corrections').upsert(
        queuedPending.map((q) => ({
          user_id: user.id,
          run_id: insertedRun.id,
          wrong_text: q.wrong,
          correct_text: q.correct,
          occurrences: 1,
          engine: q.engine,
          status: 'pending',
        })),
        { onConflict: 'user_id,wrong_text,correct_text', ignoreDuplicates: false },
      );
    }

    toast({
      title: 'הריצה נשמרה',
      description: `${autoApplied.length} תיקונים אוטומטיים, ${queuedPending.length} ממתינים לאישור`,
    });
    void refreshLists();
  };

  const approvePending = async (p: PendingCorrection) => {
    learnFromCorrections([buildCorrection(p.wrong_text, p.correct_text, p.occurrences, p.engine || 'manual')]);
    await supabase.from('asr_pending_corrections').update({ status: 'approved', resolved_at: new Date().toISOString() }).eq('id', p.id);
    toast({ title: 'תיקון אושר', description: `${p.wrong_text} → ${p.correct_text}` });
    void refreshLists();
  };
  const rejectPending = async (p: PendingCorrection) => {
    await supabase.from('asr_pending_corrections').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', p.id);
    void refreshLists();
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" className="container mx-auto p-4 max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6" /> אימון תמלול — סט זהב אוטומטי
        </h1>
        <Button variant="outline" size="sm" onClick={refreshLists}>
          <RefreshCw className="h-4 w-4 ml-1" /> רענן
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        העלה קובץ אודיו של פרק תהילים / משנה / כל טקסט מהתנ"ך. המערכת תוריד אוטומטית את הטקסט הקנוני מ-Sefaria,
        תתמלל עם המנוע שבחרת, ותשווה. כל הבדל הופך לתיקון שמזין את מערכת הלמידה האישית שלך.
      </p>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* ── Source ── */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4" /> 1. מקור הטקסט</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Tabs value={sourceKind} onValueChange={(v) => setSourceKind(v as 'tanakh' | 'text')}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="tanakh">תנ"ך / משנה</TabsTrigger>
                <TabsTrigger value="text">טקסט חופשי</TabsTrigger>
              </TabsList>
              <TabsContent value="tanakh" className="space-y-2 pt-3">
                <Label className="text-xs">ספר</Label>
                <Select value={book} onValueChange={setBook}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TANAKH_BOOKS.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">פרק</Label>
                    <Input type="number" min={1} value={chapter} onChange={(e) => setChapter(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">פסוקים (אופציונלי)</Label>
                    <Input placeholder="1-10" value={verses} onChange={(e) => setVerses(e.target.value)} />
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="text" className="pt-3">
                <Label className="text-xs">הדבק טקסט קנוני</Label>
                <Textarea rows={6} value={freeText} onChange={(e) => setFreeText(e.target.value)} dir="rtl" />
              </TabsContent>
            </Tabs>
            <Button onClick={fetchReference} variant="secondary" className="w-full">טען טקסט קנוני</Button>
            {refText && (
              <div className="rounded-md border p-2 bg-muted/30 text-xs space-y-1">
                <Badge variant="secondary">{refLabel}</Badge>
                <ScrollArea className="h-32"><div className="whitespace-pre-wrap">{refText}</div></ScrollArea>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Audio ── */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" /> 2. קובץ אודיו</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setAudioFile(f); }}
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/30 transition"
            >
              {audioFile ? (
                <div className="space-y-1">
                  <div className="font-medium text-sm">{audioFile.name}</div>
                  <div className="text-xs text-muted-foreground">{(audioFile.size / 1024 / 1024).toFixed(2)} MB</div>
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setAudioFile(null); }}>
                    <Trash2 className="h-3 w-3 ml-1" /> הסר
                  </Button>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">גרור קובץ או לחץ לבחירה (mp3 / wav / m4a / webm)</div>
              )}
            </div>
            {audioFile && (
              <audio controls src={URL.createObjectURL(audioFile)} className="w-full" />
            )}
          </CardContent>
        </Card>

        {/* ── Engines + Learning mode ── */}
        <Card>
          <CardHeader><CardTitle className="text-base">3. מנועים ולמידה</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label className="text-xs">מנועי תמלול</Label>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="eng-lovable" checked={useLovable} onChange={(e) => setUseLovable(e.target.checked)} />
                <label htmlFor="eng-lovable" className="text-sm flex-1">Lovable AI</label>
                <Select value={lovableModel} onValueChange={setLovableModel} disabled={!useLovable}>
                  <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai/gpt-4o-mini-transcribe">mini (מהיר)</SelectItem>
                    <SelectItem value="openai/gpt-4o-transcribe">full (מדויק)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="eng-local" checked={useLocal} onChange={(e) => setUseLocal(e.target.checked)} />
                <label htmlFor="eng-local" className="text-sm flex-1">שרת מקומי (CUDA + ivrit.ai)</label>
              </div>
              {useLocal && (
                <Input value={localServerUrl} onChange={(e) => setLocalServerUrl(e.target.value)} placeholder="http://localhost:3000" className="text-xs h-8" />
              )}
            </div>

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs">מצב למידה אוטומטית</Label>
              <RadioGroup value={learningMode} onValueChange={(v) => setLearningMode(v as LearningMode)}>
                <div className="flex items-center gap-2"><RadioGroupItem value="auto" id="m-auto" /><label htmlFor="m-auto" className="text-sm">🟢 אוטומטי — שמור כל תיקון (חוץ מדו-משמעיים)</label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="hybrid" id="m-hybrid" /><label htmlFor="m-hybrid" className="text-sm">🟡 היברידי — אוטומטי על 2+ הופעות, אחרת לאישור</label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="manual" id="m-manual" /><label htmlFor="m-manual" className="text-sm">🔴 ידני — הכל ממתין לאישור</label></div>
              </RadioGroup>
            </div>

            <Button onClick={runComparison} disabled={running || !audioFile || !(refText || (sourceKind === 'text' && freeText.trim()))} className="w-full">
              {running ? 'מתמלל…' : 'התחל השוואה ולמידה'}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Results ── */}
      {results.length > 0 && (
        <Card>
          <CardHeader><CardTitle>תוצאות</CardTitle></CardHeader>
          <CardContent>
            <div className={`grid gap-4 ${results.length === 2 ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              {results.map((r, i) => (
                <div key={i} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Badge>{r.engine === 'lovable' ? 'Lovable AI' : 'שרת מקומי'}</Badge>
                    <span className="text-xs text-muted-foreground">{r.model}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-sm">
                    <Metric label="WER" value={pct(r.metrics.wer)} good={r.metrics.wer < 0.15} />
                    <Metric label="CER" value={pct(r.metrics.cer)} good={r.metrics.cer < 0.10} />
                    <Metric label="מונחים" value={pct(r.metrics.termRecall)} good={r.metrics.termRecall > 0.85} />
                    <Metric label="זמן" value={`${(r.metrics.elapsedMs / 1000).toFixed(1)}s`} />
                  </div>
                  <Separator />
                  <ScrollArea className="h-48">
                    <div className="text-sm leading-7" dir="rtl">
                      {r.diff.map((op, idx) => {
                        if (op.type === 'eq') return <span key={idx}>{op.ref} </span>;
                        if (op.type === 'sub') return (
                          <span key={idx} className="px-1 rounded bg-amber-500/15 text-amber-900 dark:text-amber-200" title={`expected: ${op.ref}`}>
                            <span className="line-through opacity-60">{op.hyp}</span>→{op.ref}{' '}
                          </span>
                        );
                        if (op.type === 'ins') return <span key={idx} className="px-1 rounded bg-rose-500/15 text-rose-900 dark:text-rose-200 line-through">{op.hyp} </span>;
                        if (op.type === 'del') return <span key={idx} className="px-1 rounded bg-emerald-500/15 text-emerald-900 dark:text-emerald-200">{op.ref} </span>;
                        return null;
                      })}
                    </div>
                  </ScrollArea>
                  <div className="text-xs text-muted-foreground">
                    {r.candidates.length} תיקונים מועמדים · החלפות={r.metrics.sub} · הוספות={r.metrics.ins} · השמטות={r.metrics.del}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Pending corrections ── */}
      {pending.length > 0 && (
        <Card>
          <CardHeader><CardTitle>תיקונים ממתינים לאישור ({pending.length})</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {pending.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 p-2 rounded border">
                    <span className="text-rose-600 line-through">{p.wrong_text}</span>
                    <span>→</span>
                    <span className="text-emerald-600 font-medium">{p.correct_text}</span>
                    <Badge variant="outline" className="text-xs">×{p.occurrences}</Badge>
                    <div className="flex-1" />
                    <Button size="sm" variant="ghost" onClick={() => approvePending(p)}><Check className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => rejectPending(p)}><X className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* ── Learning curve / history ── */}
      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle>היסטוריית ריצות (עקומת למידה)</CardTitle></CardHeader>
          <CardContent>
            <ScrollArea className="h-72">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr><th className="text-right p-1">תאריך</th><th className="text-right p-1">מקור</th><th className="p-1">מנוע A</th><th className="p-1">WER A</th><th className="p-1">מנוע B</th><th className="p-1">WER B</th><th className="p-1">תיקונים</th></tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-t">
                      <td className="p-1 text-xs">{new Date(h.created_at).toLocaleString('he-IL')}</td>
                      <td className="p-1">{h.source_label || h.source_ref}</td>
                      <td className="p-1 text-xs">{h.model_a?.split('/').pop()}</td>
                      <td className="p-1">{h.wer_a !== null ? pct(h.wer_a) : '—'}</td>
                      <td className="p-1 text-xs">{h.model_b?.split('/').pop() || '—'}</td>
                      <td className="p-1">{h.wer_b !== null ? pct(h.wer_b) : '—'}</td>
                      <td className="p-1">{h.corrections_applied}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded border p-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm ${good ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>{value}</div>
    </div>
  );
}

function buildCorrection(wrong: string, correct: string, occurrences: number, engine: string): CorrectionEntry {
  const now = Date.now();
  return {
    original: wrong,
    corrected: correct,
    note: 'asr-training',
    frequency: Math.max(1, occurrences),
    engine,
    category: wrong.includes(' ') || correct.includes(' ') ? 'phrase' : 'word',
    confidence: Math.min(1, 0.7 + occurrences * 0.1),
    lastUsed: now,
    createdAt: now,
  };
}
