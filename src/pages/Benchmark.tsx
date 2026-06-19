import { useState, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Play, Loader2, Trophy, Zap,
  Target, BarChart3,
  CheckCircle2, XCircle, Upload, Mic, StopCircle,
  Columns2, LayoutList, GitCompare,
  PenLine, GraduationCap, LibraryBig, Lightbulb, RotateCcw, ExternalLink, Star, BookOpen,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { enhanceAudioOnServer, type EnhancementPreset } from "@/lib/audioEnhancement";
import { extractAudioSegment, probeAudioDurationSec } from "@/lib/audioSegment";
import { getServerUrl } from "@/lib/serverConfig";

const SERVER = getServerUrl();
const VERDICTS_KEY = "benchmark_verdicts_v1";
const LEARNED_KEY  = "benchmark_learned_v1";
const CONCEPTS_KEY = "benchmark_concepts_v1";

// --- Types ---

interface SystemResult {
  id: string;
  label: string;
  isBaseline: boolean;
  status: "success" | "error";
  text: string;
  wordCount: number;
  avgProbability: number;
  processingTime: number;
  error?: string;
  score?: number;
}

interface DiffToken {
  word: string;
  type: "equal" | "added" | "removed";
}

interface WordDialogState {
  word: string;
  resultId: string;
  wordIdx: number;
  text: string;
}

interface Variant {
  label: string;
  word: string;
  resultId: string;
}

interface SavedVerdict {
  timestamp: string;
  fileName: string;
  systemWinner: string;
  userVerdict: string;
}

// --- Systems ---

const SYSTEMS: { id: string; label: string; preset?: EnhancementPreset; isBaseline?: boolean }[] = [
  { id: "baseline",  label: "מקור (ללא שיפור)", isBaseline: true },
  { id: "clean",     label: "שיפור — נקי",        preset: "clean" },
  { id: "podcast",   label: "שיפור — פודקאסט",   preset: "podcast" },
  { id: "broadcast", label: "שיפור — שידור",      preset: "broadcast" },
  { id: "ai_voice",  label: "שיפור — AI Voice",   preset: "ai_voice" },
];

// --- Helpers ---

function fmtSec(s: number) {
  return s < 10 ? `${s.toFixed(2)}s` : `${s.toFixed(1)}s`;
}

function computeScore(r: SystemResult, baseline: SystemResult | null): number {
  if (!baseline || r.isBaseline || r.status !== "success" || baseline.status !== "success") return 0;
  const wordDelta  = ((r.wordCount - baseline.wordCount) / Math.max(1, baseline.wordCount)) * 100;
  const confDelta  = (r.avgProbability - baseline.avgProbability) * 100;
  const speedDelta = ((baseline.processingTime - r.processingTime) / Math.max(0.001, baseline.processingTime)) * 100;
  return wordDelta * 0.35 + confDelta * 0.50 + speedDelta * 0.15;
}

function diffWords(baseText: string, compareText: string): DiffToken[] {
  const a = baseText.split(/\s+/).filter(Boolean).slice(0, 300);
  const b = compareText.split(/\s+/).filter(Boolean).slice(0, 300);
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const tokens: DiffToken[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i-1] === b[j-1]) {
      tokens.unshift({ word: b[j-1], type: "equal" }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j-1] >= dp[i-1][j])) {
      tokens.unshift({ word: b[j-1], type: "added" }); j--;
    } else {
      tokens.unshift({ word: a[i-1], type: "removed" }); i--;
    }
  }
  return tokens;
}

// --- ClickableText ---

function ClickableText({
  text, resultId, onWordClick, tokens, className = "",
}: {
  text: string;
  resultId: string;
  onWordClick: (s: WordDialogState) => void;
  tokens?: DiffToken[] | null;
  className?: string;
}) {
  const cls = "cursor-pointer rounded px-0.5 hover:ring-1 hover:ring-primary/50 hover:bg-primary/10 transition-colors select-none";

  if (tokens) {
    let idx = 0;
    return (
      <span className={className}>
        {tokens.map((tok, i) => {
          if (tok.type === "removed") {
            return <del key={i} className="text-red-400 dark:text-red-500 opacity-60">{tok.word} </del>;
          }
          const wi = idx++;
          if (tok.type === "added") {
            return (
              <mark
                key={i}
                className={`bg-green-200 dark:bg-green-900/50 text-green-900 dark:text-green-100 rounded px-0.5 ${cls}`}
                onClick={() => onWordClick({ word: tok.word, resultId, wordIdx: wi, text })}
              >{tok.word} </mark>
            );
          }
          return (
            <span key={i} className={cls} onClick={() => onWordClick({ word: tok.word, resultId, wordIdx: wi, text })}>{tok.word} </span>
          );
        })}
      </span>
    );
  }

  const words = text.split(/\s+/).filter(Boolean);
  return (
    <span className={className}>
      {words.map((word, wi) => (
        <span key={wi} className={cls} onClick={() => onWordClick({ word, resultId, wordIdx: wi, text })}>{word} </span>
      ))}
    </span>
  );
}

// ============================================================
//  Main Component
// ============================================================

export default function Benchmark() {
  const navigate = useNavigate();

  // File / mic
  const [audioFile, setAudioFile]     = useState<File | null>(null);
  const fileRef                        = useRef<HTMLInputElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRef                       = useRef<MediaRecorder | null>(null);
  const chunksRef                      = useRef<Blob[]>([]);

  // Run state
  const [running, setRunning]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const abortRef                       = useRef(false);
  const [results, setResults]         = useState<SystemResult[]>([]);

  // Verdict
  const [userVerdict, setUserVerdict]   = useState("");
  const [verdictSaved, setVerdictSaved] = useState(false);
  const [savedVerdicts, setSavedVerdicts] = useState<SavedVerdict[]>(() => {
    try { return JSON.parse(localStorage.getItem(VERDICTS_KEY) || "[]"); } catch { return []; }
  });

  // View
  const [viewMode, setViewMode] = useState<"list" | "side">("list");
  const [showDiff, setShowDiff] = useState(false);

  // Word dialog
  const [wordDialog, setWordDialog]     = useState<WordDialogState | null>(null);
  const [dialogTab, setDialogTab]       = useState("edit");
  const [editedWord, setEditedWord]     = useState("");
  const [learnMode, setLearnMode]       = useState<"card" | "quiz">("card");
  const [cardFlipped, setCardFlipped]   = useState(false);
  const [quizChoice, setQuizChoice]     = useState("");
  const [dictForm, setDictForm]         = useState({ spokenForm: "", correctForm: "", note: "" });
  const [dictSaved, setDictSaved]       = useState(false);
  const [conceptText, setConceptText]   = useState("");
  const [conceptSaved, setConceptSaved] = useState(false);
  const [learnedWords, setLearnedWords] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(LEARNED_KEY) || "[]")); } catch { return new Set(); }
  });
  const [conceptNotes, setConceptNotes] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(CONCEPTS_KEY) || "{}"); } catch { return {}; }
  });

  // Derived: variants at same relative position across all results
  const variants = useMemo<Variant[]>(() => {
    if (!wordDialog) return [];
    const thisResult = results.find(r => r.id === wordDialog.resultId);
    if (!thisResult) return [];
    const thisWords = thisResult.text.split(/\s+/).filter(Boolean);
    const relPos = wordDialog.wordIdx / Math.max(1, thisWords.length - 1);
    return results
      .filter(r => r.status === "success" && r.text)
      .map(r => {
        const ws = r.text.split(/\s+/).filter(Boolean);
        const vi = Math.min(Math.round(relPos * (ws.length - 1)), ws.length - 1);
        return { label: r.label, word: ws[vi] || "", resultId: r.id };
      });
  }, [wordDialog, results]);

  const uniqueVariants = useMemo(
    () => [...new Map(variants.map(v => [v.word, v])).values()],
    [variants]
  );

  const wordContext = useMemo(() => {
    if (!wordDialog) return { before: "", word: "", after: "" };
    const ws = wordDialog.text.split(/\s+/).filter(Boolean);
    const i  = wordDialog.wordIdx;
    return {
      before: ws.slice(Math.max(0, i - 4), i).join(" "),
      word:   ws[i] || wordDialog.word,
      after:  ws.slice(i + 1, i + 5).join(" "),
    };
  }, [wordDialog]);

  // File
  const handleFile = useCallback((file: File) => {
    setAudioFile(file);
    setResults([]);
    setUserVerdict("");
    setVerdictSaved(false);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  // Mic
  const startRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        handleFile(new File([blob], `recording_${Date.now()}.webm`, { type: "audio/webm" }));
        toast({ title: "הקלטה הושלמה", description: `${(blob.size / 1024).toFixed(0)} KB` });
      };
      rec.start();
      mediaRef.current = rec;
      setIsRecording(true);
    } catch {
      toast({ title: "לא ניתן לגשת למיקרופון", variant: "destructive" });
    }
  };

  const stopRecord = () => {
    mediaRef.current?.stop();
    mediaRef.current = null;
    setIsRecording(false);
  };

  // Main run
  const runAll = useCallback(async () => {
    if (!audioFile) { toast({ title: "בחר קובץ אודיו תחילה", variant: "destructive" }); return; }
    abortRef.current = false;
    setRunning(true); setProgress(0); setResults([]); setUserVerdict(""); setVerdictSaved(false);
    try {
      const dur = await probeAudioDurationSec(audioFile);
      const sample = await extractAudioSegment(audioFile, 0, Math.min(dur, 120));
      const allResults: SystemResult[] = [];
      for (let i = 0; i < SYSTEMS.length; i++) {
        if (abortRef.current) break;
        const sys = SYSTEMS[i];
        setCurrentStep(sys.label);
        setProgress((i / SYSTEMS.length) * 100);
        try {
          let fileToTx: File | Blob = sample;
          if (sys.preset) {
            const enh = await enhanceAudioOnServer(sample, { preset: sys.preset, outputFormat: "mp3" });
            fileToTx = enh.blob;
          }
          const fd = new FormData();
          fd.append("file", fileToTx, `${sys.id}.${sys.preset ? "mp3" : "wav"}`);
          fd.append("language", "he");
          fd.append("preset", "balanced");
          const t0 = performance.now();
          const resp = await fetch(`${SERVER}/transcribe`, { method: "POST", body: fd });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const data = await resp.json();
          const timings: { probability?: number }[] = Array.isArray(data.wordTimings) ? data.wordTimings : [];
          const avgProbability = timings.length
            ? timings.reduce((s, w) => s + (Number(w.probability) || 0), 0) / timings.length : 0;
          const text = String(data.text || "");
          allResults.push({
            id: sys.id, label: sys.label, isBaseline: !!sys.isBaseline, status: "success",
            text, wordCount: text.split(/\s+/).filter(Boolean).length,
            avgProbability, processingTime: Number(data.processing_time) || (performance.now() - t0) / 1000,
          });
        } catch (err: unknown) {
          allResults.push({
            id: sys.id, label: sys.label, isBaseline: !!sys.isBaseline,
            status: "error", text: "", wordCount: 0, avgProbability: 0, processingTime: 0,
            error: err instanceof Error ? err.message : "שגיאה",
          });
        }
        const bl = allResults.find(r => r.isBaseline && r.status === "success") || null;
        setResults(allResults.map(r => ({ ...r, score: computeScore(r, bl) })));
        setProgress(((i + 1) / SYSTEMS.length) * 100);
      }
      setCurrentStep(""); setRunning(false);

      // ── Unified trends: one row per system (audio enhancement preset) ──
      try {
        const { recordRun } = await import('@/lib/comparisonRuns');
        const { fingerprintFile } = await import('@/lib/recordingFingerprint');
        const { getCorrectionStats } = await import('@/utils/correctionLearning');
        const { getVocabularyStats } = await import('@/utils/customVocabulary');
        const fp = await fingerprintFile(audioFile);
        const hotwords_count = getVocabularyStats().totalTerms;
        const corrections_count = getCorrectionStats().totalCorrections;
        const baseline = allResults.find(r => r.isBaseline && r.status === 'success') || null;
        for (const r of allResults) {
          if (r.status !== 'success') continue;
          await recordRun({
            kind: 'audio_enhance',
            recording_fingerprint: fp,
            recording_label: audioFile.name,
            audio_duration_ms: Math.round(dur * 1000),
            engine: 'local-server',
            model: r.id,
            hotwords_count,
            corrections_count,
            hypothesis_text: r.text,
            elapsed_ms: Math.round(r.processingTime * 1000),
            len_ratio: baseline && baseline.wordCount ? r.wordCount / baseline.wordCount : null,
            config_snapshot: {
              preset: r.id,
              label: r.label,
              isBaseline: r.isBaseline,
              avgProbability: r.avgProbability,
              score: r.score ?? null,
            },
          });
        }
      } catch (err) {
        console.warn('[Benchmark] comparison_runs record failed', err);
      }

      toast({ title: "ההשוואה הושלמה!", description: `${allResults.filter(r => r.status === "success").length}/${SYSTEMS.length} מערכות` });
    } catch (err: unknown) {
      setRunning(false);
      toast({ title: "שגיאה", description: err instanceof Error ? err.message : "שגיאה", variant: "destructive" });
    }
  }, [audioFile]);

  // Word dialog handlers
  const openWordDialog = (state: WordDialogState) => {
    setWordDialog(state);
    setDialogTab("edit");
    setEditedWord(state.word);
    setCardFlipped(false);
    setLearnMode("card");
    setQuizChoice("");
    setDictForm({ spokenForm: state.word, correctForm: "", note: "" });
    setDictSaved(false);
    setConceptText(conceptNotes[state.word] || "");
    setConceptSaved(false);
  };

  const handleSaveEdit = () => {
    if (!wordDialog || !editedWord.trim()) return;
    setResults(prev => prev.map(r => {
      if (r.id !== wordDialog.resultId) return r;
      const ws = r.text.split(/\s+/).filter(Boolean);
      ws[wordDialog.wordIdx] = editedWord.trim();
      return { ...r, text: ws.join(" "), wordCount: ws.length };
    }));
    setWordDialog(prev => prev ? { ...prev, word: editedWord.trim() } : null);
    toast({ title: "המילה תוקנה" });
  };

  const handleMarkLearned = () => {
    if (!wordDialog) return;
    const word = editedWord || wordDialog.word;
    const updated = new Set(learnedWords); updated.add(word);
    setLearnedWords(updated);
    localStorage.setItem(LEARNED_KEY, JSON.stringify([...updated]));
    toast({ title: `"${word}" סומנה כנלמדה`, description: `סה"כ ${updated.size} מילים` });
  };

  const handleSaveToDict = async () => {
    if (!dictForm.spokenForm || !dictForm.correctForm) {
      toast({ title: "יש למלא שני השדות", variant: "destructive" }); return;
    }
    try {
      const res = await fetch(`${SERVER}/lk/dictionary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spoken_form: dictForm.spokenForm, correct_form: dictForm.correctForm, note: dictForm.note || undefined, source: "benchmark" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDictSaved(true);
      toast({ title: `"${dictForm.spokenForm}" נשמר למילון` });
    } catch (err) {
      toast({ title: "שגיאה", description: err instanceof Error ? err.message : "שגיאה", variant: "destructive" });
    }
  };

  const handleSaveConcept = () => {
    if (!wordDialog || !conceptText.trim()) return;
    const updated = { ...conceptNotes, [wordDialog.word]: conceptText.trim() };
    setConceptNotes(updated);
    localStorage.setItem(CONCEPTS_KEY, JSON.stringify(updated));
    setConceptSaved(true);
    toast({ title: `ההסבר נשמר` });
  };

  const saveVerdict = () => {
    if (!userVerdict.trim()) return;
    const entry: SavedVerdict = {
      timestamp: new Date().toLocaleString("he-IL"),
      fileName: audioFile?.name ?? "—",
      systemWinner: systemWinner?.label ?? "—",
      userVerdict: userVerdict.trim(),
    };
    const updated = [entry, ...savedVerdicts].slice(0, 20);
    setSavedVerdicts(updated);
    localStorage.setItem(VERDICTS_KEY, JSON.stringify(updated));
    setVerdictSaved(true);
    toast({ title: "דעתך נשמרה" });
  };

  // Derived
  const baseline     = results.find(r => r.isBaseline && r.status === "success") || null;
  const nonBaseline  = results.filter(r => !r.isBaseline && r.status === "success");
  const systemWinner = nonBaseline.length > 0 ? nonBaseline.reduce((a, b) => (a.score ?? 0) > (b.score ?? 0) ? a : b) : null;
  const sorted       = [...results].sort((a, b) => {
    if (a.isBaseline) return 1;
    if (b.isBaseline) return -1;
    return (b.score ?? 0) - (a.score ?? 0);
  });
  const displayList  = running ? results : sorted;

  // Helper for short label in dialog
  const shortLabel = (label: string) =>
    label.replace("שיפור — ", "").replace(" (ללא שיפור)", "מקור");

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="w-full py-6 px-4 md:px-8 space-y-6" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            בנצ&#39;מארק תמלול
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            השוואת איכות. לחץ על כל מילה לעריכה, למידה ושמירה.
          </p>
        </div>
        <Button
          onClick={running ? () => { abortRef.current = true; } : runAll}
          size="lg" variant={running ? "destructive" : "default"}
          className="gap-2 text-base px-6"
          disabled={!audioFile && !running}
        >
          {running ? <><XCircle className="w-5 h-5" /> עצור</> : <><Play className="w-5 h-5" /> הרץ בנצ&#39;מארק</>}
        </Button>
      </div>

      {/* File Input */}
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div
            onDrop={handleDrop} onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed rounded-xl p-6 text-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors"
          >
            <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); if (fileRef.current) fileRef.current.value = ""; }} />
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            {audioFile ? (
              <div>
                <p className="font-medium text-primary">{audioFile.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{(audioFile.size / 1024).toFixed(0)} KB</p>
              </div>
            ) : (
              <>
                <p className="font-medium">גרור קובץ אודיו לכאן / לחץ לבחירה</p>
                <p className="text-xs text-muted-foreground mt-1">MP3, WAV, M4A, OPUS, WEBM, MP4</p>
              </>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">או:</span>
            {isRecording
              ? <Button variant="destructive" onClick={stopRecord} className="gap-2"><StopCircle className="w-4 h-4" />עצור הקלטה</Button>
              : <Button variant="outline" onClick={startRecord} className="gap-2"><Mic className="w-4 h-4" />הקלט מהמיקרופון</Button>}
            {isRecording && (
              <span className="text-red-500 text-sm animate-pulse flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />מקליט…
              </span>
            )}
          </div>
          {audioFile && <p className="text-xs text-muted-foreground">יושוו {SYSTEMS.length} מערכות (עד 120 שניות)</p>}
        </CardContent>
      </Card>

      {/* Progress */}
      {running && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>מעבד: <strong>{currentStep}</strong></span>
            </div>
            <Progress value={progress} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          {systemWinner && !running && (
            <Card className="border-primary/40 bg-gradient-to-l from-primary/10 to-transparent">
              <CardContent className="pt-4 flex items-start gap-4 flex-wrap">
                <Trophy className="w-8 h-8 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-muted-foreground">המלצת המערכת:</p>
                  <p className="text-xl font-bold">{systemWinner.label}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {systemWinner.wordCount} מילים · {(systemWinner.avgProbability * 100).toFixed(1)}% ביטחון ·
                    ציון: {(systemWinner.score ?? 0) > 0 ? "+" : ""}{(systemWinner.score ?? 0).toFixed(1)}
                    {baseline ? ` (לעומת מקור: ${baseline.wordCount} מילים, ${(baseline.avgProbability * 100).toFixed(1)}%)` : ""}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">
                  תוצאות השוואה
                  <span className="text-xs font-normal text-muted-foreground mr-2">— לחץ על מילה לעריכה / למידה</span>
                </CardTitle>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant={showDiff ? "default" : "ghost"} className="h-7 w-7" title="הדגש שינויים" onClick={() => setShowDiff(v => !v)}>
                    <GitCompare className="w-4 h-4" />
                  </Button>
                  <div className="w-px h-4 bg-border mx-0.5" />
                  <Button size="icon" variant={viewMode === "list" ? "default" : "ghost"} className="h-7 w-7" title="רשימה" onClick={() => setViewMode("list")}>
                    <LayoutList className="w-4 h-4" />
                  </Button>
                  <Button size="icon" variant={viewMode === "side" ? "default" : "ghost"} className="h-7 w-7" title="אופקי" onClick={() => setViewMode("side")}>
                    <Columns2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {showDiff && (
                <p className="text-xs text-muted-foreground flex items-center gap-3 mt-1">
                  <mark className="bg-green-200 dark:bg-green-900/50 rounded px-1">נוסף</mark>
                  <del className="text-red-400 opacity-75">נמחק</del>
                </p>
              )}
            </CardHeader>
            <CardContent className="p-0">

              {/* List view */}
              {viewMode === "list" && (
                <div className="divide-y">
                  {displayList.map((r, i) => {
                    const isWinner  = r.id === systemWinner?.id;
                    const dw = baseline && !r.isBaseline && r.status === "success" ? r.wordCount - baseline.wordCount : null;
                    const dc = baseline && !r.isBaseline && r.status === "success" ? (r.avgProbability - baseline.avgProbability) * 100 : null;
                    const tokens = showDiff && baseline && !r.isBaseline && r.status === "success" ? diffWords(baseline.text, r.text) : null;
                    return (
                      <div key={r.id} className={`p-4 ${isWinner ? "bg-primary/5" : ""}`}>
                        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                          <div className="flex items-center gap-2">
                            {running && i === results.length - 1 && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                            <span className="font-semibold text-sm">{r.label}</span>
                            {isWinner && !running && <Trophy className="w-4 h-4 text-amber-500" />}
                            {r.isBaseline && <Badge variant="outline" className="text-xs">בסיס</Badge>}
                            {r.status === "error" && <Badge variant="destructive" className="text-xs">שגיאה</Badge>}
                          </div>
                          {r.status === "success" && (
                            <div className="flex gap-1.5 flex-wrap">
                              <Badge variant="secondary">{r.wordCount} מילים</Badge>
                              <Badge variant="secondary">{(r.avgProbability * 100).toFixed(1)}% ביטחון</Badge>
                              <Badge variant="outline">{fmtSec(r.processingTime)}</Badge>
                              {dw !== null && <Badge className={dw > 0 ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300" : "bg-muted text-muted-foreground"}>{dw >= 0 ? "+" : ""}{dw} מילים</Badge>}
                              {dc !== null && <Badge className={dc > 0 ? "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" : "bg-muted text-muted-foreground"}>{dc >= 0 ? "+" : ""}{dc.toFixed(1)}%</Badge>}
                              {!r.isBaseline && r.score !== undefined && <Badge variant="outline" className="font-mono text-xs">{r.score > 0 ? "+" : ""}{r.score.toFixed(1)}</Badge>}
                            </div>
                          )}
                        </div>
                        {r.status === "success" && r.text && (
                          <div className="text-sm leading-relaxed bg-muted/30 rounded p-2" dir="rtl">
                            <ClickableText text={r.text} resultId={r.id} onWordClick={openWordDialog} tokens={tokens} />
                          </div>
                        )}
                        {r.status === "error" && <p className="text-xs text-destructive">{r.error}</p>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Side-by-side view */}
              {viewMode === "side" && (
                <div className="overflow-x-auto">
                  <div className="flex divide-x divide-x-reverse" style={{ minWidth: `${displayList.length * 256}px` }}>
                    {displayList.map((r, i) => {
                      const isWinner = r.id === systemWinner?.id;
                      const tokens = showDiff && baseline && !r.isBaseline && r.status === "success" ? diffWords(baseline.text, r.text) : null;
                      return (
                        <div key={r.id} className={`flex-1 min-w-[240px] p-3 space-y-2 ${isWinner ? "bg-primary/5" : ""}`}>
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {running && i === results.length - 1 && <Loader2 className="w-3 h-3 animate-spin" />}
                              <span className="font-semibold text-xs">{r.label}</span>
                              {isWinner && !running && <Trophy className="w-3.5 h-3.5 text-amber-500" />}
                              {r.isBaseline && <Badge variant="outline" className="text-[10px] py-0 px-1">בסיס</Badge>}
                              {r.status === "error" && <Badge variant="destructive" className="text-[10px] py-0 px-1">שגיאה</Badge>}
                            </div>
                            {r.status === "success" && (
                              <div className="flex flex-wrap gap-1">
                                <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{r.wordCount} מילים</Badge>
                                <Badge variant="secondary" className="text-[10px] py-0 px-1.5">{(r.avgProbability * 100).toFixed(1)}%</Badge>
                                <Badge variant="outline" className="text-[10px] py-0 px-1.5">{fmtSec(r.processingTime)}</Badge>
                                {!r.isBaseline && r.score !== undefined && <Badge variant="outline" className="font-mono text-[10px] py-0 px-1.5">{r.score > 0 ? "+" : ""}{r.score.toFixed(1)}</Badge>}
                              </div>
                            )}
                          </div>
                          {r.status === "success" && r.text && (
                            <div className="text-xs leading-relaxed bg-muted/30 rounded p-2 max-h-52 overflow-y-auto" dir="rtl">
                              <ClickableText text={r.text} resultId={r.id} onWordClick={openWordDialog} tokens={tokens} />
                            </div>
                          )}
                          {r.status === "error" && <p className="text-[10px] text-destructive">{r.error}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* User verdict */}
          {!running && systemWinner && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Target className="w-4 h-4" />מה אתה רואה? כתוב את הערכתך
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea dir="rtl" placeholder="לדוגמה: AI Voice נשמע הרבה יותר ברור, אבל פודקאסט שמר על הניואנסים..." rows={3}
                  value={userVerdict} onChange={e => { setUserVerdict(e.target.value); setVerdictSaved(false); }} disabled={verdictSaved} />
                <Button onClick={saveVerdict} disabled={!userVerdict.trim() || verdictSaved} className="gap-2">
                  <CheckCircle2 className="w-4 h-4" />{verdictSaved ? "נשמר" : "שמור הערכה"}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && !running && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-3">
            <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground/40" />
            <p className="font-medium text-muted-foreground">אין תוצאות עדיין</p>
            <p className="text-sm text-muted-foreground">העלה קובץ אודיו ולחץ <strong>הרץ בנצ&#39;מארק</strong></p>
          </CardContent>
        </Card>
      )}

      {/* Systems legend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">מערכות מושוות</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {SYSTEMS.map(s => (
              <div key={s.id} className="flex items-center gap-2 text-sm">
                {s.isBaseline ? <Zap className="w-3.5 h-3.5 text-muted-foreground" /> : <CheckCircle2 className="w-3.5 h-3.5 text-primary/60" />}
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">ציון: 35% מילים + 50% ביטחון + 15% מהירות</p>
        </CardContent>
      </Card>

      {/* Saved verdicts */}
      {savedVerdicts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">הערכות קודמות</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {savedVerdicts.slice(0, 5).map((v, vi) => (
              <div key={vi} className="border rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{v.timestamp}</span><span>{v.fileName}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <Trophy className="w-3.5 h-3.5 text-amber-500" /><span>מומלץ: {v.systemWinner}</span>
                </div>
                <p dir="rtl" className="text-muted-foreground">{v.userVerdict}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ══════════════════ Word Click Dialog ══════════════════ */}
      <Dialog open={!!wordDialog} onOpenChange={open => { if (!open) setWordDialog(null); }}>
        <DialogContent className="max-w-2xl w-full" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <span className="text-2xl font-bold text-primary">{wordDialog?.word}</span>
              {learnedWords.has(wordDialog?.word ?? "") && (
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 text-xs">
                  <Star className="w-3 h-3 fill-current ml-1" />נלמד
                </Badge>
              )}
              {conceptNotes[wordDialog?.word ?? ""] && (
                <Badge variant="outline" className="text-xs">
                  <Lightbulb className="w-3 h-3 ml-1" />יש הסבר
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {wordDialog && (
            <div className="space-y-4">
              {/* Context */}
              <div className="bg-muted/40 rounded-lg p-3 text-sm leading-loose" dir="rtl">
                <span className="text-muted-foreground">{wordContext.before} </span>
                <span className="font-bold text-primary bg-primary/15 rounded px-1 py-0.5">{wordContext.word}</span>
                <span className="text-muted-foreground"> {wordContext.after}</span>
              </div>

              {/* Variants strip */}
              {variants.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground shrink-0">גרסאות:</span>
                  {variants.map(v => (
                    <Badge
                      key={v.resultId}
                      variant={v.resultId === wordDialog.resultId ? "default" : "outline"}
                      className="text-xs cursor-pointer hover:opacity-80"
                      onClick={() => setEditedWord(v.word)}
                      title={`לחץ לבחור "${v.word}"`}
                    >
                      {shortLabel(v.label)}: {v.word}
                    </Badge>
                  ))}
                </div>
              )}

              {/* 4 Tabs */}
              <Tabs value={dialogTab} onValueChange={setDialogTab}>
                <TabsList className="w-full grid grid-cols-4">
                  <TabsTrigger value="edit" className="gap-1 text-xs"><PenLine className="w-3.5 h-3.5" />שנה</TabsTrigger>
                  <TabsTrigger value="learn" className="gap-1 text-xs"><GraduationCap className="w-3.5 h-3.5" />למד</TabsTrigger>
                  <TabsTrigger value="dict" className="gap-1 text-xs"><LibraryBig className="w-3.5 h-3.5" />מילון</TabsTrigger>
                  <TabsTrigger value="concept" className="gap-1 text-xs"><Lightbulb className="w-3.5 h-3.5" />רעיון</TabsTrigger>
                </TabsList>

                {/* ── Tab: שנה ──────────────────────────────────── */}
                <TabsContent value="edit" className="space-y-3 pt-3">
                  <div className="space-y-1.5">
                    <Label>תיקון המילה</Label>
                    <div className="flex gap-2">
                      <Input
                        dir="rtl" value={editedWord}
                        onChange={e => setEditedWord(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleSaveEdit(); }}
                        placeholder="הזן את המילה הנכונה…"
                        className="text-base" autoFocus
                      />
                      <Button onClick={handleSaveEdit} disabled={!editedWord.trim()}>
                        <CheckCircle2 className="w-4 h-4 ml-1" />שמור
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Enter לשמירה. מעדכן את התמלול בדף.</p>
                  </div>
                  {uniqueVariants.length > 1 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">בחר מגרסאות קיימות</Label>
                      <div className="flex gap-2 flex-wrap">
                        {uniqueVariants.map(v => (
                          <Button key={v.resultId} size="sm" variant={editedWord === v.word ? "default" : "outline"}
                            className="h-7 text-sm" onClick={() => setEditedWord(v.word)}>
                            {v.word}
                            <span className="opacity-50 mr-1.5 text-[10px]">({shortLabel(v.label)})</span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* ── Tab: למד ──────────────────────────────────── */}
                <TabsContent value="learn" className="space-y-3 pt-3">
                  <div className="flex gap-1">
                    <Button size="sm" variant={learnMode === "card" ? "default" : "ghost"} className="gap-1"
                      onClick={() => { setLearnMode("card"); setCardFlipped(false); }}>
                      <BookOpen className="w-3.5 h-3.5" />כרטיס
                    </Button>
                    <Button size="sm" variant={learnMode === "quiz" ? "default" : "ghost"} className="gap-1"
                      onClick={() => { setLearnMode("quiz"); setQuizChoice(""); }}>
                      <GraduationCap className="w-3.5 h-3.5" />חידון
                    </Button>
                  </div>

                  {/* Flashcard */}
                  {learnMode === "card" && (
                    <div
                      className="border rounded-xl p-6 text-center cursor-pointer hover:bg-muted/20 transition-colors min-h-[140px] flex flex-col items-center justify-center gap-3"
                      onClick={() => setCardFlipped(v => !v)}
                    >
                      {!cardFlipped ? (
                        <>
                          <p className="text-4xl font-bold text-primary" dir="rtl">{wordDialog.word}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <RotateCcw className="w-3 h-3" />לחץ להפוך ולראות גרסאות
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground mb-1">גרסאות ממערכות שונות:</p>
                          <div className="space-y-1.5 w-full max-w-xs">
                            {variants.map(v => (
                              <div key={v.resultId} className="flex justify-between items-center px-3 py-1.5 rounded-lg bg-muted/50">
                                <span className="text-xs text-muted-foreground">{shortLabel(v.label)}</span>
                                <span className={`font-semibold text-sm ${v.resultId === wordDialog.resultId ? "text-primary" : ""}`}>{v.word}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Quiz */}
                  {learnMode === "quiz" && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">איזו גרסה נכונה יותר לדעתך?</p>
                      <div className="space-y-2">
                        {uniqueVariants.map(v => (
                          <button
                            key={v.word} dir="rtl"
                            className={`w-full text-right px-4 py-3 rounded-lg border text-sm transition-colors ${
                              quizChoice === v.word
                                ? "border-primary bg-primary/10 font-semibold"
                                : "border-border hover:border-primary/50 hover:bg-muted/50"
                            }`}
                            onClick={() => { setQuizChoice(v.word); setDictForm(prev => ({ ...prev, correctForm: v.word })); }}
                          >
                            {v.word}
                            <span className="text-[10px] text-muted-foreground mr-2">({shortLabel(v.label)})</span>
                          </button>
                        ))}
                      </div>
                      {quizChoice && (
                        <Button size="sm" variant="outline" className="gap-1 w-full" onClick={() => setDialogTab("dict")}>
                          <LibraryBig className="w-3.5 h-3.5" />שמור "{quizChoice}" כצורה הנכונה במילון
                        </Button>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-2 border-t flex-wrap">
                    <Button
                      size="sm" variant={learnedWords.has(wordDialog.word) ? "default" : "outline"}
                      className="gap-1" onClick={handleMarkLearned}
                    >
                      <Star className={`w-3.5 h-3.5 ${learnedWords.has(wordDialog.word) ? "fill-current" : ""}`} />
                      {learnedWords.has(wordDialog.word) ? "נלמד" : "סמן כנלמד"}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate("/lk?tab=training")}>
                      <ExternalLink className="w-3.5 h-3.5" />שלח לאימון לשון הקודש
                    </Button>
                  </div>
                  {learnedWords.size > 0 && <p className="text-xs text-muted-foreground">סה"כ {learnedWords.size} מילים נלמדו</p>}
                </TabsContent>

                {/* ── Tab: מילון ────────────────────────────────── */}
                <TabsContent value="dict" className="space-y-3 pt-3">
                  <div className="space-y-2.5">
                    <div className="space-y-1.5">
                      <Label>צורה מדוברת — כפי שתומלל</Label>
                      <Input dir="rtl" value={dictForm.spokenForm}
                        onChange={e => setDictForm(prev => ({ ...prev, spokenForm: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>צורה נכונה — כפי שצריך להיות</Label>
                      <Input dir="rtl" value={dictForm.correctForm} placeholder="הזן את הצורה הנכונה…"
                        onChange={e => setDictForm(prev => ({ ...prev, correctForm: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>הערה (אופציונלי)</Label>
                      <Input dir="rtl" value={dictForm.note} placeholder="הסבר, הקשר, מקור…"
                        onChange={e => setDictForm(prev => ({ ...prev, note: e.target.value }))} />
                    </div>
                    <Button onClick={handleSaveToDict}
                      disabled={!dictForm.spokenForm || !dictForm.correctForm || dictSaved}
                      className="w-full gap-2">
                      <LibraryBig className="w-4 h-4" />
                      {dictSaved ? "נשמר במילון לשון הקודש" : "שמור למילון"}
                    </Button>
                    {dictSaved && (
                      <p className="text-xs text-center text-muted-foreground">
                        המילה זמינה לתיקון אוטומטי בתמלולים עתידיים
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* ── Tab: רעיון ────────────────────────────────── */}
                <TabsContent value="concept" className="space-y-3 pt-3">
                  <div className="space-y-2">
                    <Label>הסבר את הרעיון מאחורי המילה</Label>
                    <p className="text-xs text-muted-foreground">
                      למה המילה הזו חשובה? מה הדקדוק / ההלכה / המושג שמאחוריה?
                    </p>
                    <Textarea
                      dir="rtl" rows={5}
                      placeholder="לדוגמה: המילה תפילין מגיעה מהשורש פ.ל.ל — להתפלל. הצורה הנכונה ב..."
                      value={conceptText}
                      onChange={e => { setConceptText(e.target.value); setConceptSaved(false); }}
                    />
                    <Button onClick={handleSaveConcept} disabled={!conceptText.trim() || conceptSaved} className="w-full gap-2">
                      <Lightbulb className="w-4 h-4" />
                      {conceptSaved ? "ההסבר נשמר" : "שמור הסבר"}
                    </Button>
                  </div>
                  {conceptNotes[wordDialog.word] && !conceptSaved && (
                    <div className="bg-muted/40 rounded p-3">
                      <p className="text-xs text-muted-foreground mb-1">הסבר קיים:</p>
                      <p className="text-sm" dir="rtl">{conceptNotes[wordDialog.word]}</p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
