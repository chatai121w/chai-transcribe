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
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Upload, Sparkles, BookOpen, Trash2, Check, X, RefreshCw, Download, HardDrive, Cloud, CloudOff, Pencil, LayoutList, StretchHorizontal, LayoutGrid, Columns2, Columns3, Columns4, Table as TableIcon, LayoutPanelTop, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { normalizeHebrew } from '@/lib/hebrewNormalize';
import {
  computeWER, computeCER, computeTermRecall, lenRatio,
  wordDiff, extractCorrectionCandidates, isAmbiguous, type DiffOp,
} from '@/lib/asrMetrics';
import { learnFromCorrections, getCorrectionThreshold, setCorrectionThreshold, type CorrectionEntry } from '@/utils/correctionLearning';
import { Slider } from '@/components/ui/slider';
import { syncLearnedCorrections, getLastSyncAt, type SyncState } from '@/lib/syncLearnedCorrections';
import {
  loadLocalSessions, saveLocalSession, deleteLocalSession,
  exportLocalSessionsJson, clearLocalSessions, removePendingCorrectionsFromLocalSessions, type LocalSession,
} from '@/lib/asrLocalSessions';

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

const LOCAL_PENDING_KEY = 'asr_training_pending_corrections_v1';

function pendingKey(p: Pick<PendingCorrection, 'wrong_text' | 'correct_text'>): string {
  return `${p.wrong_text.trim()}→${p.correct_text.trim()}`;
}

function dedupePending(items: PendingCorrection[]): PendingCorrection[] {
  const map = new Map<string, PendingCorrection>();
  for (const item of items) {
    const key = pendingKey(item);
    const existing = map.get(key);
    map.set(key, existing ? { ...existing, ...item, occurrences: Math.max(existing.occurrences || 1, item.occurrences || 1) } : item);
  }
  return Array.from(map.values());
}

function mergePending(localItems: PendingCorrection[], cloudItems: PendingCorrection[]): PendingCorrection[] {
  return dedupePending([...localItems, ...cloudItems]);
}

function loadLocalPendingCorrections(): PendingCorrection[] {
  try {
    const raw = localStorage.getItem(LOCAL_PENDING_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? dedupePending(parsed) : [];
  } catch {
    return [];
  }
}

function loadPendingCorrectionsFromLocalSessions(): PendingCorrection[] {
  return loadLocalSessions().flatMap((session) => session.pending.map((item, index) => ({
    id: `local_session_${session.id}_${index}`,
    wrong_text: item.wrong,
    correct_text: item.correct,
    occurrences: 1,
    engine: item.engine,
    created_at: new Date(session.createdAt).toISOString(),
  })));
}

function loadPersistentPendingCorrections(): PendingCorrection[] {
  return mergePending(loadLocalPendingCorrections(), loadPendingCorrectionsFromLocalSessions());
}

function saveLocalPendingCorrections(items: PendingCorrection[]): void {
  try {
    localStorage.setItem(LOCAL_PENDING_KEY, JSON.stringify(dedupePending(items)));
  } catch (err) {
    console.warn('Local pending corrections save failed:', err);
  }
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
  const [pending, setPending] = useState<PendingCorrection[]>(() => loadPersistentPendingCorrections());
  const [selectedPending, setSelectedPending] = useState<Set<string>>(new Set());
  const [saveLocally, setSaveLocally] = useState<boolean>(
    () => localStorage.getItem('asr_training_save_local') !== 'false',
  );
  const [saveCloud, setSaveCloud] = useState<boolean>(
    () => localStorage.getItem('asr_training_save_cloud') !== 'false',
  );
  const [localSessions, setLocalSessions] = useState<LocalSession[]>(() => loadLocalSessions());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingCorrection[]>(pending);

  useEffect(() => { localStorage.setItem('asr_training_mode', learningMode); }, [learningMode]);
  useEffect(() => { localStorage.setItem('asr_training_local_url', localServerUrl); }, [localServerUrl]);
  useEffect(() => { localStorage.setItem('asr_training_save_local', String(saveLocally)); }, [saveLocally]);
  useEffect(() => { localStorage.setItem('asr_training_save_cloud', String(saveCloud)); }, [saveCloud]);

  const commitPending = (updater: (prev: PendingCorrection[]) => PendingCorrection[]) => {
    setPending((prev) => {
      const next = dedupePending(updater(prev));
      pendingRef.current = next;
      saveLocalPendingCorrections(next);
      return next;
    });
  };

  // Load history + pending corrections — MERGE with local items, never replace them
  const refreshLists = async () => {
    if (!user) {
      commitPending((prev) => mergePending(loadPersistentPendingCorrections(), prev));
      return;
    }
    const [{ data: runs }, { data: pend }] = await Promise.all([
      supabase.from('asr_training_runs').select('*').order('created_at', { ascending: false }).limit(30),
      supabase.from('asr_pending_corrections').select('*').eq('status', 'pending').order('occurrences', { ascending: false }).limit(500),
    ]);
    if (runs) setHistory(runs as SavedRun[]);
    const cloud = (pend ?? []) as PendingCorrection[];
    commitPending((prev) => mergePending([...loadPersistentPendingCorrections(), ...pendingRef.current, ...prev], cloud));
  };
  useEffect(() => { void refreshLists(); }, [user?.id]);

  // ─── Learned-corrections cloud sync (asr_learned_corrections) ───
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const [syncStats, setSyncStats] = useState<{ pushed: number; pulled: number; total: number } | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(() => getLastSyncAt());
  const syncInFlight = useRef(false);

  const runLearnedSync = async (opts?: { silent?: boolean }) => {
    if (!user) { setSyncState('offline'); return; }
    if (syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncState('syncing');
    try {
      const res = await syncLearnedCorrections(user.id);
      setSyncStats({ pushed: res.pushed, pulled: res.pulled, total: res.total });
      setLastSyncAt(res.at);
      setSyncState('synced');
      if (!opts?.silent && (res.pushed > 0 || res.pulled > 0)) {
        toast({
          title: 'מילון התיקונים סונכרן לענן',
          description: `↑ ${res.pushed} נשלחו · ↓ ${res.pulled} התקבלו · סה"כ ${res.total}`,
        });
      }
    } catch (err: any) {
      console.error('[learned-sync] failed', err);
      setSyncState('error');
      if (!opts?.silent) {
        toast({ title: 'סנכרון נכשל', description: err?.message || String(err), variant: 'destructive' });
      }
    } finally {
      syncInFlight.current = false;
    }
  };

  // initial pull when user becomes available
  useEffect(() => {
    if (!user) { setSyncState('offline'); return; }
    void runLearnedSync({ silent: true });
  }, [user?.id]);


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

  const saveRun = async (results: EngineResult[], effectiveRef: string = refText) => {
    if (results.length === 0) return;
    const a = results[0];
    const b = results[1];

    // Auto-applied corrections (per learning mode, based on engine A's diff)
    const autoApplied: CorrectionEntry[] = [];
    const autoSummary: Array<{ wrong: string; correct: string; occurrences: number; engine: string }> = [];
    const queuedPending: Array<{ wrong: string; correct: string; engine: string }> = [];

    if (a) {
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
          autoSummary.push({ wrong, correct, occurrences: n, engine: a.engine });
        } else if (learningMode === 'hybrid') {
          if (n >= 2) {
            autoApplied.push(buildCorrection(wrong, correct, n, a.engine));
            autoSummary.push({ wrong, correct, occurrences: n, engine: a.engine });
          } else queuedPending.push({ wrong, correct, engine: a.engine });
        } else {
          queuedPending.push({ wrong, correct, engine: a.engine });
        }
      }
    }

    if (autoApplied.length > 0) {
      learnFromCorrections(autoApplied);
      if (user) void runLearnedSync({ silent: true });
    }

    const sourceRef = sourceKind === 'tanakh' ? `${book}.${chapter}${verses.trim() ? `.${verses.trim()}` : ''}` : null;

    // ── Local save ──
    if (saveLocally) {
      const session: LocalSession = {
        id: crypto.randomUUID?.() ?? `local_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        createdAt: Date.now(),
        label: refLabel || 'ללא כותרת',
        sourceKind,
        sourceRef,
        refText: effectiveRef,
        audioFilename: audioFile?.name ?? null,
        learningMode,
        results: results.map((r) => ({
          engine: r.engine, model: r.model, hyp: r.hyp,
          metrics: r.metrics, candidates: r.candidates,
        })),
        autoApplied: autoSummary,
        pending: queuedPending,
      };
      saveLocalSession(session);
      setLocalSessions(loadLocalSessions());
    }

    // ── Cloud save ──
    if (saveCloud && user) {
      const { data: insertedRun, error: runErr } = await supabase
        .from('asr_training_runs')
        .insert({
          user_id: user.id,
          source_kind: sourceKind,
          source_ref: sourceRef,
          source_label: refLabel,
          ref_text: effectiveRef,
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

      if (runErr) {
        toast({ title: 'שמירה לענן נכשלה', description: runErr.message, variant: 'destructive' });
      } else if (queuedPending.length > 0 && insertedRun) {
        const { error: pendErr } = await supabase.from('asr_pending_corrections').upsert(
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
        if (pendErr) {
          toast({ title: 'שמירת תיקונים ממתינים נכשלה', description: pendErr.message, variant: 'destructive' });
        }
      }
    }

    // Optimistically show pending items in UI immediately (works even without cloud save)
    if (queuedPending.length > 0) {
      const createdAt = new Date().toISOString();
      const synthetic: PendingCorrection[] = queuedPending.map((q, i) => ({
        id: `local_${Date.now()}_${i}`,
        wrong_text: q.wrong,
        correct_text: q.correct,
        occurrences: 1,
        engine: q.engine,
        created_at: createdAt,
      }));
      commitPending((prev) => {
        const existing = new Set(prev.map(pendingKey));
        const fresh = synthetic.filter((s) => !existing.has(pendingKey(s)));
        return [...fresh, ...prev];
      });
      // Scroll the pending list into view so the user sees the new items
      setTimeout(() => {
        document.getElementById('pending-corrections')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }

    const destinations = [saveLocally && 'מקומי', saveCloud && user && 'ענן'].filter(Boolean).join(' + ') || 'לא נשמר';
    toast({
      title: `הריצה נשמרה (${destinations})`,
      description: `${autoApplied.length} תיקונים אוטומטיים, ${queuedPending.length} ממתינים לאישור`,
    });
    void refreshLists();
  };


  const approvePending = async (items: PendingCorrection[]) => {
    if (items.length === 0) return;
    const entries = items.map((p) => buildCorrection(p.wrong_text, p.correct_text, p.occurrences, p.engine || 'manual'));
    learnFromCorrections(entries);
    const nowIso = new Date().toISOString();
    const dbIds = items.map((p) => p.id).filter((id) => !id.startsWith('local_'));
    if (dbIds.length > 0) {
      const { error } = await supabase.from('asr_pending_corrections').update({ status: 'approved', resolved_at: nowIso }).in('id', dbIds);
      if (error) {
        toast({ title: 'אישור נכשל', description: error.message, variant: 'destructive' });
        return;
      }
    }
    // Push local-only items to cloud as approved (so all corrections live in cloud too)
    const localItems = items.filter((p) => p.id.startsWith('local_'));
    if (localItems.length > 0 && user) {
      const { error } = await supabase.from('asr_pending_corrections').upsert(
        localItems.map((p) => ({
          user_id: user.id,
          wrong_text: p.wrong_text,
          correct_text: p.correct_text,
          occurrences: p.occurrences || 1,
          engine: p.engine || 'manual',
          status: 'approved',
          resolved_at: nowIso,
        })),
        { onConflict: 'user_id,wrong_text,correct_text', ignoreDuplicates: false },
      );
      if (error) {
        toast({ title: 'שמירת תיקונים בענן נכשלה', description: error.message, variant: 'destructive' });
      }
    }
    const approvedKeys = new Set(items.map(pendingKey));
    removePendingCorrectionsFromLocalSessions(items.map((p) => ({ wrong: p.wrong_text, correct: p.correct_text })));
    commitPending((prev) => prev.filter((p) => !approvedKeys.has(pendingKey(p))));
    if (items.length === 1) {
      toast({ title: 'תיקון אושר', description: `${items[0].wrong_text} → ${items[0].correct_text}` });
    } else {
      toast({ title: `${items.length} תיקונים אושרו`, description: 'נשמרו למערכת הלמידה ולענן' });
    }
    setSelectedPending(new Set());
    if (user) void runLearnedSync({ silent: true });
    void refreshLists();
  };
  const rejectPending = async (p: PendingCorrection) => {
    if (!p.id.startsWith('local_')) {
      const { error } = await supabase.from('asr_pending_corrections').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', p.id);
      if (error) {
        toast({ title: 'דחייה נכשלה', description: error.message, variant: 'destructive' });
        return;
      }
    } else if (user) {
      // Mirror rejection to cloud so the same pair won't resurface from another device
      await supabase.from('asr_pending_corrections').upsert(
        [{
          user_id: user.id,
          wrong_text: p.wrong_text,
          correct_text: p.correct_text,
          occurrences: p.occurrences || 1,
          engine: p.engine || 'manual',
          status: 'rejected',
          resolved_at: new Date().toISOString(),
        }],
        { onConflict: 'user_id,wrong_text,correct_text', ignoreDuplicates: false },
      );
    }
    const rejectedKey = pendingKey(p);
    removePendingCorrectionsFromLocalSessions([{ wrong: p.wrong_text, correct: p.correct_text }]);
    commitPending((prev) => prev.filter((x) => pendingKey(x) !== rejectedKey));
    void refreshLists();
  };

  // ─── Manual add ───
  const [manualWrong, setManualWrong] = useState('');
  const [manualCorrect, setManualCorrect] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editWrong, setEditWrong] = useState('');
  const [editCorrect, setEditCorrect] = useState('');
  type PendingViewMode = 'list' | 'horizontal' | 'grid2' | 'grid3' | 'grid4' | 'table';
  const [pendingView, setPendingView] = useState<PendingViewMode>(() => {
    const v = localStorage.getItem('asr_pending_view') as PendingViewMode | null;
    return v && ['list','horizontal','grid2','grid3','grid4','table'].includes(v) ? v : 'list';
  });
  useEffect(() => { localStorage.setItem('asr_pending_view', pendingView); }, [pendingView]);
  const PENDING_VIEW_OPTIONS: Array<{ value: PendingViewMode; label: string; icon: typeof LayoutList; hint?: string }> = [
    { value: 'list',       label: 'רשימה אנכית',     icon: LayoutList, hint: 'מומלץ' },
    { value: 'horizontal', label: 'גלילה אופקית',    icon: StretchHorizontal },
    { value: 'grid2',      label: '2 עמודות',         icon: Columns2 },
    { value: 'grid3',      label: '3 עמודות',         icon: Columns3 },
    { value: 'grid4',      label: '4 עמודות',         icon: Columns4 },
    { value: 'table',      label: 'טבלה',             icon: TableIcon },
  ];
  const currentViewIcon = (PENDING_VIEW_OPTIONS.find((o) => o.value === pendingView)?.icon) ?? LayoutList;
  const addManualCorrection = async (opts: { approveNow: boolean }) => {
    const wrong = manualWrong.trim();
    const correct = manualCorrect.trim();
    if (!wrong || !correct) {
      toast({ title: 'חסר טקסט', description: 'מלא גם שגוי וגם נכון', variant: 'destructive' });
      return;
    }
    if (wrong === correct) {
      toast({ title: 'אין הבדל', description: 'השגוי והנכון זהים', variant: 'destructive' });
      return;
    }
    const item: PendingCorrection = {
      id: `local_manual_${Date.now()}`,
      wrong_text: wrong,
      correct_text: correct,
      occurrences: 1,
      engine: 'manual',
      created_at: new Date().toISOString(),
    };
    // Add to UI/local immediately
    commitPending((prev) => {
      const k = pendingKey(item);
      if (prev.some((p) => pendingKey(p) === k)) return prev;
      return [item, ...prev];
    });
    // Save to cloud as pending too (when logged in)
    if (user && saveCloud) {
      const { error } = await supabase.from('asr_pending_corrections').upsert(
        [{
          user_id: user.id,
          wrong_text: wrong,
          correct_text: correct,
          occurrences: 1,
          engine: 'manual',
          status: 'pending',
        }],
        { onConflict: 'user_id,wrong_text,correct_text', ignoreDuplicates: false },
      );
      if (error) {
        toast({ title: 'שמירה לענן נכשלה', description: error.message, variant: 'destructive' });
      }
    }
    setManualWrong('');
    setManualCorrect('');
    if (opts.approveNow) {
      await approvePending([item]);
    } else {
      toast({ title: 'תיקון נוסף לרשימת המתנה', description: `${wrong} → ${correct}` });
    }
  };

  const togglePendingSelection = (id: string) => {
    setSelectedPending((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAllPending = () => {
    setSelectedPending(new Set(pending.map((p) => p.id)));
  };
  const clearPendingSelection = () => {
    setSelectedPending(new Set());
  };

  const startEdit = (p: PendingCorrection) => {
    setEditingId(p.id);
    setEditWrong(p.wrong_text);
    setEditCorrect(p.correct_text);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditWrong('');
    setEditCorrect('');
  };
  const saveEdit = async (original: PendingCorrection) => {
    const wrong = editWrong.trim();
    const correct = editCorrect.trim();
    if (!wrong || !correct) {
      toast({ title: 'חסר טקסט', description: 'מלא גם שגוי וגם נכון', variant: 'destructive' });
      return;
    }
    if (wrong === correct) {
      toast({ title: 'אין הבדל', description: 'השגוי והנכון זהים', variant: 'destructive' });
      return;
    }
    commitPending((prev) =>
      prev.map((item) =>
        item.id === original.id ? { ...item, wrong_text: wrong, correct_text: correct } : item
      )
    );
    if (!original.id.startsWith('local_') && user) {
      const { error } = await supabase
        .from('asr_pending_corrections')
        .update({ wrong_text: wrong, correct_text: correct })
        .eq('id', original.id);
      if (error) {
        toast({ title: 'עדכון בענן נכשל', description: error.message, variant: 'destructive' });
      }
    }
    setEditingId(null);
    setEditWrong('');
    setEditCorrect('');
    toast({ title: 'תיקון עודכן', description: `${wrong} → ${correct}` });
  };

  // ─── Local sessions ───
  const loadLocalIntoUI = (s: LocalSession) => {
    setRefText(s.refText);
    setRefLabel(s.label);
    setSourceKind(s.sourceKind);
    setResults(s.results.map((r) => {
      const evalRes = evaluateRun(s.refText, r.hyp, r.metrics.elapsedMs);
      return {
        engine: r.engine as Engine,
        model: r.model,
        hyp: r.hyp,
        metrics: r.metrics,
        diff: evalRes.diff,
        candidates: r.candidates,
      };
    }));
    toast({ title: 'סשן נטען', description: s.label });
  };
  const handleDeleteLocal = (id: string) => {
    deleteLocalSession(id);
    setLocalSessions(loadLocalSessions());
  };
  const handleExportLocal = () => {
    const blob = new Blob([exportLocalSessionsJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `asr-sessions-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const handleClearLocal = () => {
    if (!confirm('למחוק את כל הסשנים המקומיים?')) return;
    clearLocalSessions();
    setLocalSessions([]);
  };

  // ─── Pending item renderer (shared across view modes) ───

  // Build a normalized pool of reference texts (current + recent local sessions)
  // and provide a memoized lookup for the sentence(s) that contain a pending word.
  const contextSources = useMemo(() => {
    const arr: string[] = [];
    if (refText && refText.trim()) arr.push(refText);
    for (const s of localSessions) {
      if (s.refText && s.refText.trim()) arr.push(s.refText);
    }
    return arr;
  }, [refText, localSessions]);

  const contextCacheRef = useRef<Map<string, string>>(new Map());
  useEffect(() => { contextCacheRef.current = new Map(); }, [contextSources]);

  const findContextSentence = (wrong: string, correct: string): string => {
    const key = `${wrong}→${correct}`;
    const cache = contextCacheRef.current;
    if (cache.has(key)) return cache.get(key)!;
    const targets = [wrong, correct].map((t) => t.trim()).filter(Boolean);
    if (targets.length === 0 || contextSources.length === 0) {
      cache.set(key, '');
      return '';
    }
    const stripNikud = (s: string) => s.replace(/[\u0591-\u05C7]/g, '');
    const normTargets = targets.map(stripNikud);
    const maxLineChars = 90;
    const windowHalf = 50;

    // Split into sentences on Hebrew/Latin sentence terminators and line breaks.
    const splitter = /(?<=[.!?؟׃]|[\n])\s+|[\n\r]+/;
    for (const src of contextSources) {
      const stripped = stripNikud(src);
      const sentences = stripped.split(splitter).map((s) => s.trim()).filter(Boolean);
      const idx = sentences.findIndex((s) => normTargets.some((t) => s.includes(t)));
      if (idx >= 0) {
        const a = sentences[idx];
        const b = sentences[idx + 1] ?? sentences[idx - 1] ?? '';
        const limit = (s: string) => {
          if (!s || s.length <= maxLineChars) return s;
          const matchIdx = normTargets
            .map((t) => s.indexOf(t))
            .filter((i) => i >= 0)
            .sort((x, y) => x - y)[0];
          const center = matchIdx >= 0 ? matchIdx + Math.floor(normTargets[0].length / 2) : Math.floor(s.length / 2);
          const start = Math.max(0, center - windowHalf);
          const end = Math.min(s.length, center + windowHalf);
          let out = '';
          if (start > 0) out += '…';
          out += s.slice(start, end).trim();
          if (end < s.length) out += '…';
          return out;
        };
        const la = limit(a);
        const lb = b ? limit(b) : '';
        const out = lb ? `${la}\n${lb}` : la;
        cache.set(key, out);
        return out;
      }
    }
    cache.set(key, '');
    return '';
  };

  // Render context with the wrong/correct words highlighted.
  const renderContext = (text: string, wrong: string, correct: string) => {
    if (!text) return null;
    const targets = [wrong, correct].filter(Boolean).sort((a, b) => b.length - a.length);
    if (targets.length === 0) return <span>{text}</span>;
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${targets.map(escape).join('|')})`, 'g');
    return (
      <>
        {text.split('\n').slice(0, 2).map((line, li) => (
          <div key={li} className="leading-relaxed">
            {line.split(re).map((part, i) =>
              targets.includes(part) ? (
                <mark key={i} className="bg-rose-500/20 text-rose-700 rounded px-0.5 font-semibold">{part}</mark>
              ) : (
                <span key={i}>{part}</span>
              )
            )}
          </div>
        ))}
      </>
    );
  };

  const renderPendingItem = (p: PendingCorrection, variant: 'row' | 'card' | 'tableRow') => {
    const isEditing = editingId === p.id;
    const isSelected = selectedPending.has(p.id);

    const Texts = isEditing ? (
      <>
        <Input
          value={editWrong}
          onChange={(e) => setEditWrong(e.target.value)}
          className="h-7 text-xs w-28"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(p); }}
        />
        <span className="text-xs">→</span>
        <Input
          value={editCorrect}
          onChange={(e) => setEditCorrect(e.target.value)}
          className="h-7 text-xs w-28"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(p); }}
        />
      </>
    ) : (
      <>
        <span className="text-rose-600 line-through truncate">{p.wrong_text}</span>
        <span>→</span>
        <span className="text-emerald-600 font-medium truncate">{p.correct_text}</span>
      </>
    );

    const Actions = isEditing ? (
      <>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); void saveEdit(p); }}>
          <Check className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); cancelEdit(); }}>
          <X className="h-4 w-4" />
        </Button>
      </>
    ) : (
      <>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); startEdit(p); }}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); approvePending([p]); }}>
          <Check className="h-4 w-4" />
        </Button>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); rejectPending(p); }}>
          <X className="h-4 w-4" />
        </Button>
      </>
    );

    const ctx = findContextSentence(p.wrong_text, p.correct_text);
    const tooltipContent = (
      <TooltipContent side="top" align="center" className="max-w-md text-xs leading-relaxed" dir="rtl">
        {ctx ? (
          renderContext(ctx, p.wrong_text, p.correct_text)
        ) : (
          <>
            <div className="text-muted-foreground">אין הקשר זמין מהתמליל הנוכחי</div>
            <div className="text-muted-foreground/70">העלה/טען מחדש את המקור כדי לראות את הפסוק</div>
          </>
        )}
      </TooltipContent>
    );

    if (variant === 'tableRow') {
      return (
        <Tooltip key={p.id} delayDuration={200}>
          <TooltipTrigger asChild>
            <tr
              className={`border-t cursor-pointer transition-colors ${isSelected ? 'bg-yellow-500/10' : 'hover:bg-muted/40'}`}
              onClick={() => !isEditing && togglePendingSelection(p.id)}
            >
              <td className="p-2 w-8">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => !isEditing && togglePendingSelection(p.id)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={isEditing}
                />
              </td>
              <td className="p-2">
                {isEditing ? (
                  <Input value={editWrong} onChange={(e) => setEditWrong(e.target.value)} className="h-7 text-xs"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(p); }} />
                ) : (
                  <span className="text-rose-600 line-through">{p.wrong_text}</span>
                )}
              </td>
              <td className="p-2">
                {isEditing ? (
                  <Input value={editCorrect} onChange={(e) => setEditCorrect(e.target.value)} className="h-7 text-xs"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { if (e.key === 'Enter') void saveEdit(p); }} />
                ) : (
                  <span className="text-emerald-600 font-medium">{p.correct_text}</span>
                )}
              </td>
              <td className="p-2 text-xs text-muted-foreground">×{p.occurrences}</td>
              <td className="p-2 text-left whitespace-nowrap">{Actions}</td>
            </tr>
          </TooltipTrigger>
          {tooltipContent}
        </Tooltip>
      );
    }

    if (variant === 'card') {
      return (
        <Tooltip key={p.id} delayDuration={200}>
          <TooltipTrigger asChild>
            <div
              className={`rounded border p-2 flex flex-col gap-2 cursor-pointer transition-colors ${isSelected ? 'bg-yellow-500/10 border-yellow-500/40' : 'hover:bg-muted/50'}`}
              onClick={() => !isEditing && togglePendingSelection(p.id)}
            >
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => !isEditing && togglePendingSelection(p.id)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={isEditing}
                />
                <Badge variant="outline" className="text-xs">×{p.occurrences}</Badge>
                <div className="flex-1" />
                {Actions}
              </div>
              <div className="flex items-center gap-2 flex-wrap text-sm">
                {Texts}
              </div>
            </div>
          </TooltipTrigger>
          {tooltipContent}
        </Tooltip>
      );
    }

    // row (list / horizontal)
    return (
      <Tooltip key={p.id} delayDuration={200}>
        <TooltipTrigger asChild>
          <div
            className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${variant === 'row' ? '' : ''} ${isSelected ? 'bg-yellow-500/10 border-yellow-500/40' : 'hover:bg-muted/50'}`}
            onClick={() => !isEditing && togglePendingSelection(p.id)}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => !isEditing && togglePendingSelection(p.id)}
              onClick={(e) => e.stopPropagation()}
              disabled={isEditing}
            />
            {Texts}
            <Badge variant="outline" className="text-xs">×{p.occurrences}</Badge>
            <div className="flex-1" />
            {Actions}
          </div>
        </TooltipTrigger>
        {tooltipContent}
      </Tooltip>
    );
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

            <Separator />

            <div className="space-y-2">
              <Label className="text-xs">שמירת סשן</Label>
              <div className="flex items-center gap-2">
                <Checkbox id="save-local" checked={saveLocally} onCheckedChange={(v) => setSaveLocally(!!v)} />
                <label htmlFor="save-local" className="text-sm flex items-center gap-1 flex-1">
                  <HardDrive className="h-3 w-3" /> מקומי (דפדפן)
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="save-cloud" checked={saveCloud} onCheckedChange={(v) => setSaveCloud(!!v)} disabled={!user} />
                <label htmlFor="save-cloud" className="text-sm flex items-center gap-1 flex-1">
                  <Cloud className="h-3 w-3" /> בענן {!user && <span className="text-xs text-muted-foreground">(דרושה התחברות)</span>}
                </label>
              </div>
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
        <CardContent className="space-y-3">
          {/* Manual add row */}
          <div className="flex flex-wrap items-end gap-2 p-3 rounded-md border bg-muted/20">
            <div className="flex-1 min-w-[140px]">
              <Label className="text-xs">שגוי (כפי שמופיע בתמלול)</Label>
              <Input
                value={manualWrong}
                onChange={(e) => setManualWrong(e.target.value)}
                placeholder="לדוגמה: רב פפה"
                dir="rtl"
                className="h-9"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <Label className="text-xs">נכון</Label>
              <Input
                value={manualCorrect}
                onChange={(e) => setManualCorrect(e.target.value)}
                placeholder="לדוגמה: רב פפא"
                dir="rtl"
                className="h-9"
                onKeyDown={(e) => { if (e.key === 'Enter') void addManualCorrection({ approveNow: false }); }}
              />
            </div>
            <Button size="sm" variant="outline" onClick={() => void addManualCorrection({ approveNow: false })}>
              הוסף לרשימה
            </Button>
            <Button size="sm" onClick={() => void addManualCorrection({ approveNow: true })}>
              <Check className="h-4 w-4 ml-1" /> הוסף ואשר מיד
            </Button>
          </div>

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

      {/* ── Pending corrections (always visible) ── */}
      <Card id="pending-corrections" className="border-yellow-500/40">
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2">
              <Checkbox
                checked={pending.length > 0 && selectedPending.size === pending.length}
                onCheckedChange={(v) => (v ? selectAllPending() : clearPendingSelection())}
                disabled={pending.length === 0}
                aria-label="בחר הכל"
              />
              תיקונים ממתינים לאישור ({pending.length})
              {(() => {
                const SyncIcon =
                  syncState === 'syncing' ? Loader2 :
                  syncState === 'synced'  ? CheckCircle2 :
                  syncState === 'error'   ? AlertCircle :
                  syncState === 'offline' ? CloudOff : Cloud;
                const color =
                  syncState === 'syncing' ? 'text-blue-500' :
                  syncState === 'synced'  ? 'text-emerald-600' :
                  syncState === 'error'   ? 'text-rose-600' :
                  syncState === 'offline' ? 'text-muted-foreground' : 'text-muted-foreground';
                const label =
                  syncState === 'syncing' ? 'מסנכרן מילון תיקונים לענן…' :
                  syncState === 'synced'  ? `מילון תיקונים סונכרן${syncStats ? ` · סה"כ ${syncStats.total} · ↑${syncStats.pushed} ↓${syncStats.pulled}` : ''}${lastSyncAt ? ` · עודכן ${new Date(lastSyncAt).toLocaleTimeString('he-IL')}` : ''}` :
                  syncState === 'error'   ? 'סנכרון נכשל — לחץ כדי לנסות שוב' :
                  syncState === 'offline' ? 'לא מחובר — תיקונים נשמרים מקומית בלבד' :
                  'לחץ לסנכרון מילון התיקונים עם הענן';
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => void runLearnedSync()}
                        disabled={!user || syncState === 'syncing'}
                        className={`inline-flex items-center justify-center h-7 w-7 rounded-md border border-border hover:bg-accent transition-colors ${color} disabled:opacity-60 disabled:cursor-not-allowed`}
                        aria-label={label}
                      >
                        <SyncIcon className={`h-4 w-4 ${syncState === 'syncing' ? 'animate-spin' : ''}`} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-xs">{label}</TooltipContent>
                  </Tooltip>
                );
              })()}
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" title="תצוגה" aria-label="שנה תצוגה">
                    {(() => { const Icon = currentViewIcon; return <Icon className="h-4 w-4" />; })()}
                    <LayoutPanelTop className="h-3 w-3 mr-1 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel className="text-xs">תצוגה</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {PENDING_VIEW_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const active = pendingView === opt.value;
                    return (
                      <DropdownMenuItem key={opt.value} onClick={() => setPendingView(opt.value)} className={active ? 'bg-yellow-500/10 font-medium' : ''}>
                        <Icon className="h-4 w-4 ml-2" />
                        <span className="flex-1">{opt.label}</span>
                        {opt.hint && <span className="text-[10px] text-muted-foreground mr-2">{opt.hint}</span>}
                        {active && <Check className="h-3 w-3 mr-2" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              {pending.length > 0 && (
                <>
                  <Button size="sm" variant="outline" onClick={selectAllPending} disabled={selectedPending.size === pending.length}>
                    בחר הכל
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearPendingSelection} disabled={selectedPending.size === 0}>
                    בטל בחירה
                  </Button>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => approvePending(pending.filter((p) => selectedPending.has(p.id)))}
                    disabled={selectedPending.size === 0}
                  >
                    <Check className="h-4 w-4 ml-1" /> אשר נבחרים ({selectedPending.size})
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => approvePending(pending)}>
                    <Check className="h-4 w-4 ml-1" /> אשר הכל
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pending.length === 0 ? (
            <div className="text-sm text-muted-foreground p-4 text-center border border-dashed rounded">
              אין כרגע תיקונים ממתינים לאישור.
              <br />
              הרץ השוואה במצב למידה <b>"ידני"</b> או <b>"היברידי"</b> כדי לראות תיקונים כאן.
              <br />
              <span className="text-xs">מצב למידה נוכחי: <b>{learningMode}</b></span>
            </div>
          ) : pendingView === 'list' ? (
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {pending.map((p) => renderPendingItem(p, 'row'))}
              </div>
            </ScrollArea>
          ) : pendingView === 'horizontal' ? (
            <ScrollArea className="w-full" dir="rtl">
              <div className="flex gap-2 pb-3">
                {pending.map((p) => (
                  <div key={p.id} className="min-w-[280px] max-w-[320px] flex-shrink-0">
                    {renderPendingItem(p, 'card')}
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : pendingView === 'table' ? (
            <ScrollArea className="h-72">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="p-2 w-8"></th>
                    <th className="p-2 text-right">שגוי</th>
                    <th className="p-2 text-right">נכון</th>
                    <th className="p-2 text-right w-16">הופעות</th>
                    <th className="p-2 text-left w-32">פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((p) => renderPendingItem(p, 'tableRow'))}
                </tbody>
              </table>
            </ScrollArea>
          ) : (
            <ScrollArea className="h-96">
              <div className={`grid gap-2 ${
                pendingView === 'grid2' ? 'grid-cols-1 md:grid-cols-2' :
                pendingView === 'grid3' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' :
                'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              }`}>
                {pending.map((p) => renderPendingItem(p, 'card'))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>



      {/* ── Local sessions ── */}
      {localSessions.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-4 w-4" /> סשנים מקומיים ({localSessions.length})
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={handleExportLocal}>
                  <Download className="h-4 w-4 ml-1" /> ייצוא JSON
                </Button>
                <Button size="sm" variant="ghost" onClick={handleClearLocal}>
                  <Trash2 className="h-4 w-4 ml-1" /> נקה הכל
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {localSessions.map((s) => {
                  const a = s.results[0];
                  const b = s.results[1];
                  return (
                    <div key={s.id} className="flex items-center gap-2 p-2 rounded border text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(s.createdAt).toLocaleString('he-IL')}
                          {a && ` · A: ${a.model.split('/').pop()} WER ${pct(a.metrics.wer)}`}
                          {b && ` · B: ${b.model.split('/').pop()} WER ${pct(b.metrics.wer)}`}
                          {` · ${s.autoApplied.length + s.pending.length} תיקונים`}
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => loadLocalIntoUI(s)}>טען</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteLocal(s.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
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
