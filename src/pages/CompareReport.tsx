import { useState, useRef, useCallback, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Upload, BarChart3, History, Eye, Loader2, Play, CheckCircle2, XCircle,
  Star, AlertTriangle, TrendingUp, Clock, FileAudio, RefreshCw,
  GitCompare, ChevronDown, FileDown,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getServerUrl } from "@/lib/serverConfig";
import { jsPDF } from "jspdf";

const SERVER = getServerUrl();

// ─── Types ───────────────────────────────────────────────────────────────────

interface CmpResult {
  id: string;
  label: string;
  beam: number;
  normalize: boolean;
  denoise: boolean;
  text: string;
  word_count: number;
  elapsed_s: number;
  avg_prob: number;
  words: { word: string; prob: number }[];
  error: string | null;
}

interface AudioInfo {
  filename: string;
  duration_s: number;
  channels: number;
  sample_rate: number;
  dynamic_range_db: number;
  snr_estimate_db: number;
  noise_rms: number;
  noise_level_label: string;
  clipping_count?: number;
}

interface CmpSession {
  session_id: string;
  created_at: string;
  audio_filename: string;
  duration_s: number;
  noise_level: string;
  recommended_id: string;
  user_chosen_id: string | null;
  results: CmpResult[];
  audio_info?: AudioInfo;
  rec_reason?: string;
}

interface RunState {
  status: "idle" | "running" | "done" | "error";
  progress: number;
  completed: number;
  total: number;
  session_id: string;
  audio_info: AudioInfo | null;
  recommended_id: string;
  rec_reason: string;
  results: CmpResult[];
  error?: string;
}

// ─── Word-level diff ─────────────────────────────────────────────────────────

type DiffToken = { word: string; type: "same" | "only-a" | "only-b" };

function wordDiff(a: string, b: string): DiffToken[] {
  const wa = a.split(/\s+/).filter(Boolean);
  const wb = b.split(/\s+/).filter(Boolean);

  // LCS via DP
  const m = wa.length, n = wb.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = wa[i - 1] === wb[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Traceback
  const tokens: DiffToken[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wa[i - 1] === wb[j - 1]) {
      tokens.unshift({ word: wa[i - 1], type: "same" });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      tokens.unshift({ word: wb[j - 1], type: "only-b" });
      j--;
    } else {
      tokens.unshift({ word: wa[i - 1], type: "only-a" });
      i--;
    }
  }
  return tokens;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function AudioInfoCards({ info }: { info: AudioInfo }) {
  const dur = info.duration_s;
  const durStr = `${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, "0")}`;
  const noiseColor =
    info.noise_level_label === "נקי" ? "text-green-600 dark:text-green-400" :
    info.noise_level_label === "רעש קל" ? "text-amber-500 dark:text-amber-400" :
    info.noise_level_label === "רעש בינוני" ? "text-orange-500 dark:text-orange-400" :
    "text-red-500 dark:text-red-400";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: "משך", value: durStr },
        { label: "ערוצים", value: info.channels === 1 ? "מונו" : "סטריאו" },
        { label: "Dynamic Range", value: `${info.dynamic_range_db?.toFixed(1) ?? "—"}dB` },
        { label: "SNR", value: `${info.snr_estimate_db?.toFixed(1) ?? "—"}dB` },
      ].map(({ label, value }) => (
        <Card key={label}>
          <CardContent className="pt-4 text-center">
            <div className="text-xl font-bold">{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </CardContent>
        </Card>
      ))}
      <Card className="col-span-2 sm:col-span-4">
        <CardContent className="pt-3 flex items-center gap-2 text-sm">
          <span className={`font-bold ${noiseColor}`}>{info.noise_level_label}</span>
          <span className="text-muted-foreground">— {info.filename}</span>
          {(info.clipping_count ?? 0) > 50 && (
            <Badge variant="destructive" className="text-xs mr-auto">
              <AlertTriangle className="w-3 h-3 ml-1" /> קליפינג!
            </Badge>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ResultCard({
  result,
  isRecommended,
  isUserChoice,
  rank,
  onChoose,
}: {
  result: CmpResult;
  isRecommended: boolean;
  isUserChoice: boolean;
  rank: number;
  onChoose: () => void;
}) {
  const [expanded, setExpanded] = useState(isRecommended);
  const probColor = result.avg_prob >= 0.85 ? "text-green-600 dark:text-green-400"
    : result.avg_prob >= 0.65 ? "text-amber-500 dark:text-amber-400"
    : "text-red-500 dark:text-red-400";

  if (result.error) {
    return (
      <Card className="border-destructive/40 opacity-70">
        <CardContent className="pt-4 flex items-center gap-3 text-sm">
          <XCircle className="w-4 h-4 text-destructive shrink-0" />
          <span className="font-medium">{result.label}</span>
          <span className="text-muted-foreground text-xs">{result.error}</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className={`transition-all ${
        isRecommended ? "border-primary ring-1 ring-primary/30" :
        isUserChoice ? "border-green-500 ring-1 ring-green-500/30" : ""
      }`}
    >
      <CardContent className="pt-4 space-y-3">
        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-muted-foreground w-5">{rank}.</span>
          <span className="font-semibold text-sm">{result.label}</span>
          {isRecommended && (
            <Badge className="text-xs bg-primary/15 text-primary border-primary/30">
              <Star className="w-3 h-3 ml-1" /> מומלץ
            </Badge>
          )}
          {isUserChoice && (
            <Badge className="text-xs bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30">
              <CheckCircle2 className="w-3 h-3 ml-1" /> בחרת
            </Badge>
          )}
          {result.normalize && <Badge variant="outline" className="text-xs">norm</Badge>}
          {result.denoise && <Badge variant="outline" className="text-xs bg-purple-50 dark:bg-purple-950/30">denoise</Badge>}
          <div className="mr-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className={`font-mono font-bold ${probColor}`}>{Math.round(result.avg_prob * 100)}%</span>
            <span><Clock className="w-3 h-3 inline" /> {result.elapsed_s}s</span>
            <span>📝 {result.word_count}</span>
          </div>
        </div>

        {/* Text preview */}
        <div
          className="text-sm leading-6 bg-muted/30 rounded p-3 cursor-pointer"
          dir="rtl"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? result.text : (result.text.slice(0, 120) + (result.text.length > 120 ? "…" : ""))}
          {result.text.length > 120 && (
            <ChevronDown className={`inline w-4 h-4 mr-1 transition-transform ${expanded ? "rotate-180" : ""}`} />
          )}
        </div>

        {/* Word confidence heatmap (when expanded) */}
        {expanded && result.words.length > 0 && (
          <div className="text-sm leading-7 p-2 bg-muted/20 rounded" dir="rtl">
            {result.words.map((w, i) => (
              <span
                key={i}
                className={`mx-0.5 cursor-default ${
                  w.prob >= 0.85 ? "text-green-700 dark:text-green-400" :
                  w.prob >= 0.65 ? "text-amber-600 dark:text-amber-400" :
                  "text-red-600 dark:text-red-400 font-medium"
                }`}
                title={`${Math.round(w.prob * 100)}%`}
              >
                {w.word}
              </span>
            ))}
          </div>
        )}

        <Button
          size="sm"
          variant={isUserChoice ? "default" : "outline"}
          className="w-full text-xs"
          onClick={onChoose}
        >
          {isUserChoice ? "✓ זו הבחירה שלי" : "זה הכי טוב — בחר"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Word diff viewer ────────────────────────────────────────────────────────

function WordDiffViewer({ results }: { results: CmpResult[] }) {
  const ok = results.filter((r) => !r.error && r.text);
  const [idxA, setIdxA] = useState(0);
  const [idxB, setIdxB] = useState(Math.min(1, ok.length - 1));

  if (ok.length < 2) return null;

  const a = ok[idxA];
  const b = ok[idxB];
  const tokens = wordDiff(a.text, b.text);

  const sameCount = tokens.filter((t) => t.type === "same").length;
  const onlyA = tokens.filter((t) => t.type === "only-a").length;
  const onlyB = tokens.filter((t) => t.type === "only-b").length;
  const total = tokens.length || 1;
  const similarity = Math.round((sameCount / total) * 100);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <GitCompare className="w-4 h-4" />
          השוואת מילים בין שתי מערכות
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* System selectors */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">מערכת א׳ (כחול)</label>
            <select
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
              value={idxA}
              onChange={(e) => { const v = Number(e.target.value); setIdxA(v); if (v === idxB) setIdxB(v === 0 ? 1 : 0); }}
            >
              {ok.map((r, i) => <option key={r.id} value={i}>{r.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">מערכת ב׳ (כתום)</label>
            <select
              className="w-full text-sm border rounded px-2 py-1.5 bg-background"
              value={idxB}
              onChange={(e) => { const v = Number(e.target.value); setIdxB(v); if (v === idxA) setIdxA(v === 0 ? 1 : 0); }}
            >
              {ok.map((r, i) => <option key={r.id} value={i}>{r.label}</option>)}
            </select>
          </div>
        </div>

        {/* Similarity bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>דמיון: {similarity}%</span>
            <span>
              <span className="text-blue-600 dark:text-blue-400">רק ב-א: {onlyA}</span>
              {" · "}
              <span className="text-orange-500 dark:text-orange-400">רק ב-ב: {onlyB}</span>
              {" · "}
              <span className="text-muted-foreground">זהה: {sameCount}</span>
            </span>
          </div>
          <Progress value={similarity} className="h-2" />
        </div>

        {/* Legend */}
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 dark:bg-green-900 inline-block" /> זהה בשתיהן</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-200 dark:bg-blue-900 inline-block" /> רק ב-א׳</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-200 dark:bg-orange-900 inline-block" /> רק ב-ב׳</span>
        </div>

        {/* Unified diff text */}
        <div className="leading-8 text-sm p-3 bg-muted/20 rounded-lg" dir="rtl">
          {tokens.map((t, i) => (
            <span
              key={i}
              className={`mx-0.5 px-1 rounded ${
                t.type === "same" ? "bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300" :
                t.type === "only-a" ? "bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 line-through decoration-blue-400" :
                "bg-orange-100 dark:bg-orange-950/50 text-orange-800 dark:text-orange-300 font-medium"
              }`}
              title={t.type === "same" ? "זהה" : t.type === "only-a" ? `רק ב-${a.label}` : `רק ב-${b.label}`}
            >
              {t.word}
            </span>
          ))}
        </div>

        {/* Side-by-side plain text */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">{a.label}</div>
            <div className="p-2 bg-blue-50/50 dark:bg-blue-950/20 rounded text-xs leading-5" dir="rtl">{a.text}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-orange-500 dark:text-orange-400 mb-1">{b.label}</div>
            <div className="p-2 bg-orange-50/50 dark:bg-orange-950/20 rounded text-xs leading-5" dir="rtl">{b.text}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Run tab ─────────────────────────────────────────────────────────────────

function TabRun() {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<RunState>({
    status: "idle", progress: 0, completed: 0, total: 12,
    session_id: "", audio_info: null,
    recommended_id: "", rec_reason: "", results: [],
  });
  const [userChoice, setUserChoice] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const runCompare = useCallback(async (f: File) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState((s) => ({ ...s, status: "running", progress: 0, completed: 0, results: [], session_id: "" }));
    setUserChoice(null);

    const fd = new FormData();
    fd.append("file", f);

    try {
      const resp = await fetch(`${SERVER}/compare/run`, { method: "POST", body: fd, signal: ctrl.signal });
      if (!resp.ok) throw new Error(await resp.text());
      const reader = resp.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "audio_info") {
              setState((s) => ({
                ...s,
                audio_info: evt.audio_info,
                session_id: evt.session_id,
                recommended_id: evt.recommended_id,
                rec_reason: evt.rec_reason,
                total: evt.total,
              }));
            } else if (evt.type === "result") {
              setState((s) => ({
                ...s,
                results: [...s.results, evt.result],
                completed: evt.index + 1,
                progress: Math.round(((evt.index + 1) / evt.total) * 100),
              }));
            } else if (evt.type === "done") {
              setState((s) => ({ ...s, status: "done", progress: 100, results: evt.results }));
              toast({ title: "✓ השוואה הושלמה", description: `${evt.results.filter((r: CmpResult) => !r.error).length} מערכות רצו בהצלחה` });
            } else if (evt.type === "error") {
              setState((s) => ({ ...s, status: "error", error: evt.error }));
              toast({ title: "שגיאה", description: evt.error, variant: "destructive" });
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch (e: unknown) {
      if ((e as Error).name !== "AbortError") {
        const msg = e instanceof Error ? e.message : "שגיאה";
        setState((s) => ({ ...s, status: "error", error: msg }));
        toast({ title: "שגיאת חיבור", description: msg, variant: "destructive" });
      }
    }
  }, []);

  const saveFeedback = async () => {
    if (!state.session_id || !userChoice) return;
    setSaving(true);
    try {
      const r = await fetch(`${SERVER}/compare/sessions/${state.session_id}/feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_chosen_id: userChoice, user_notes: notes }),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: "✓ משוב נשמר", description: "יסייע לשיפור המלצות עתידיות" });
    } catch (e: unknown) {
      toast({ title: "שגיאה", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const sortedResults = [...state.results].sort((a, b) => {
    if (a.error && !b.error) return 1;
    if (!a.error && b.error) return -1;
    return b.avg_prob - a.avg_prob;
  });

  return (
    <div className="space-y-6" dir="rtl">
      {/* Upload */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
              ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            onClick={() => fileRef.current?.click()}
          >
            <FileAudio className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">גרור קובץ אודיו או לחץ לבחירה</p>
            {file && <p className="mt-2 font-medium text-primary text-sm">{file.name}</p>}
            <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
          </div>

          <div className="flex gap-3">
            <Button
              onClick={() => { if (file) runCompare(file); }}
              disabled={!file || state.status === "running"}
              className="gap-2"
            >
              {state.status === "running"
                ? <><Loader2 className="w-4 h-4 animate-spin" /> מריץ {state.completed}/{state.total}…</>
                : <><Play className="w-4 h-4" /> הרץ השוואת 12 מערכות</>
              }
            </Button>
            {state.status === "running" && (
              <Button variant="outline" onClick={() => abortRef.current?.abort()}>עצור</Button>
            )}
          </div>

          {/* Progress */}
          {(state.status === "running" || state.status === "done") && state.total > 0 && (
            <div className="space-y-1">
              <Progress value={state.progress} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {state.status === "done" ? "✓ הושלם" : `${state.completed} / ${state.total} מערכות…`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audio info */}
      {state.audio_info && (
        <AudioInfoCards info={state.audio_info} />
      )}

      {/* Recommendation */}
      {state.recommended_id && state.status === "done" && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
          <CardContent className="pt-4 flex items-start gap-3">
            <Star className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-base">
                המלצה: {state.results.find((r) => r.id === state.recommended_id)?.label ?? state.recommended_id}
              </p>
              <p className="text-sm text-muted-foreground">{state.rec_reason}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Word diff */}
      {state.results.length >= 2 && <WordDiffViewer results={state.results} />}

      {/* Results grid */}
      {state.results.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-semibold text-sm text-muted-foreground">
            תוצאות כל המערכות — ממוין לפי ביטחון
          </h2>
          {sortedResults.map((r, i) => (
            <ResultCard
              key={r.id}
              result={r}
              rank={i + 1}
              isRecommended={r.id === state.recommended_id}
              isUserChoice={r.id === userChoice}
              onChoose={() => setUserChoice(r.id)}
            />
          ))}
        </div>
      )}

      {/* Feedback */}
      {userChoice && state.session_id && (
        <Card className="border-green-300 dark:border-green-800">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              שמור משוב — ישפר המלצות עתידיות
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              בחרת: <strong>{state.results.find((r) => r.id === userChoice)?.label}</strong>
            </p>
            <Textarea
              placeholder="הערות אופציונליות (למה זו הבחירה הטובה?)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              dir="rtl"
              rows={2}
            />
            <Button onClick={saveFeedback} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              שמור משוב
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── History tab ─────────────────────────────────────────────────────────────

function TabHistory() {
  const [sessions, setSessions] = useState<CmpSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<CmpSession | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${SERVER}/compare/sessions?limit=50`);
      setSessions(await r.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadSession = async (sid: string) => {
    try {
      const r = await fetch(`${SERVER}/compare/sessions/${sid}`);
      const data = await r.json();
      setViewing(data);
    } catch (e: unknown) {
      toast({ title: "שגיאה", description: (e as Error).message, variant: "destructive" });
    }
  };

  if (viewing) {
    const exportPdf = () => {
      const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const margin = 15;
      let y = margin;
      const lh = 6; // line height

      // Title
      doc.setFontSize(16);
      doc.text('Transcription Compare Report', margin, y); y += lh * 2;

      doc.setFontSize(10);
      doc.text(`File: ${viewing.audio_filename}`, margin, y); y += lh;
      doc.text(`Date: ${viewing.created_at?.slice(0, 19).replace('T', ' ')}`, margin, y); y += lh;
      doc.text(`Noise level: ${viewing.noise_level}`, margin, y); y += lh;
      if (viewing.audio_info) {
        const ai = viewing.audio_info;
        doc.text(`Duration: ${ai.duration_s.toFixed(1)}s | SR: ${ai.sample_rate}Hz | DR: ${ai.dynamic_range_db.toFixed(1)}dB | SNR: ${ai.snr_estimate_db.toFixed(1)}dB`, margin, y);
        y += lh;
      }
      y += lh;

      // Recommended system
      const recResult = viewing.results.find(r => r.id === viewing.recommended_id);
      if (recResult) {
        doc.setFontSize(11);
        doc.text(`Recommended: ${recResult.label}`, margin, y); y += lh;
        if (viewing.rec_reason) { doc.setFontSize(9); doc.text(`Reason: ${viewing.rec_reason}`, margin, y); y += lh; }
      }
      y += lh;

      // Systems table
      doc.setFontSize(11);
      doc.text('Systems (ranked by confidence):', margin, y); y += lh * 1.5;
      doc.setFontSize(9);

      const sorted = [...viewing.results].sort((a, b) => b.avg_prob - a.avg_prob);
      for (const r of sorted) {
        if (y > 270) { doc.addPage(); y = margin; }
        const rank = sorted.indexOf(r) + 1;
        const rec = r.id === viewing.recommended_id ? ' [REC]' : '';
        const chosen = r.id === viewing.user_chosen_id ? ' [CHOSEN]' : '';
        doc.text(
          `#${rank}  ${r.label}${rec}${chosen}   prob=${(r.avg_prob * 100).toFixed(1)}%  words=${r.word_count}  time=${r.elapsed_s.toFixed(1)}s`,
          margin, y
        );
        y += lh;
        if (r.text) {
          // Wrap text to ~80 chars per line
          const lines = doc.splitTextToSize(r.text.slice(0, 400), 170);
          for (const line of lines.slice(0, 4)) {
            if (y > 270) { doc.addPage(); y = margin; }
            doc.setTextColor(100);
            doc.text(line, margin + 4, y); y += lh;
            doc.setTextColor(0);
          }
          if (r.text.length > 400) { doc.text('  ...', margin + 4, y); y += lh; }
        }
        y += 2;
      }

      doc.save(`compare-${viewing.audio_filename.replace(/\.[^.]+$/, '')}-${viewing.session_id}.pdf`);
      toast({ title: 'PDF נשמר!' });
    };

    return (
      <div className="space-y-5" dir="rtl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setViewing(null)}>← חזרה</Button>
          <h2 className="font-semibold">{viewing.audio_filename}</h2>
          <Badge variant="outline">{viewing.noise_level}</Badge>
          <Button size="sm" variant="outline" className="mr-auto flex items-center gap-1.5" onClick={exportPdf}>
            <FileDown className="h-3.5 w-3.5" />
            ייצא PDF
          </Button>
        </div>

        {viewing.audio_info && <AudioInfoCards info={viewing.audio_info} />}

        {viewing.rec_reason && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4 text-sm flex gap-2">
              <Star className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>מומלץ: <strong>{viewing.results.find((r) => r.id === viewing.recommended_id)?.label ?? viewing.recommended_id}</strong> — {viewing.rec_reason}</span>
            </CardContent>
          </Card>
        )}

        {viewing.results?.length >= 2 && <WordDiffViewer results={viewing.results} />}

        <div className="space-y-3">
          {[...viewing.results]
            .sort((a, b) => b.avg_prob - a.avg_prob)
            .map((r, i) => (
              <ResultCard
                key={r.id}
                result={r}
                rank={i + 1}
                isRecommended={r.id === viewing.recommended_id}
                isUserChoice={r.id === viewing.user_chosen_id}
                onChoose={() => {}}
              />
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-sm text-muted-foreground">{sessions.length} סשנים שמורים</h2>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="gap-1">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          רענן
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : sessions.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <History className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>אין היסטוריה עדיין. הרץ השוואה ראשונה!</p>
          </CardContent>
        </Card>
      ) : (
        <ScrollArea className="max-h-[600px]">
          <Table dir="rtl">
            <TableHeader>
              <TableRow>
                <TableHead>תאריך</TableHead>
                <TableHead>קובץ</TableHead>
                <TableHead>רעש</TableHead>
                <TableHead>מומלץ</TableHead>
                <TableHead>נבחר</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.session_id} className="cursor-pointer hover:bg-muted/40" onClick={() => loadSession(s.session_id)}>
                  <TableCell className="text-xs text-muted-foreground">{s.created_at?.slice(0, 16) ?? "—"}</TableCell>
                  <TableCell className="text-sm max-w-[140px] truncate">{s.audio_filename}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{s.noise_level || "—"}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{s.recommended_id || "—"}</TableCell>
                  <TableCell>
                    {s.user_chosen_id ? (
                      <Badge className={`text-xs ${s.user_chosen_id === s.recommended_id ? "bg-green-500/20 text-green-700 dark:text-green-300" : "bg-amber-500/20 text-amber-700"}`}>
                        {s.user_chosen_id === s.recommended_id ? "✓ מדויק" : s.user_chosen_id}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Eye className="w-4 h-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  );
}

// ─── Stats tab ───────────────────────────────────────────────────────────────

function TabStats() {
  const [sessions, setSessions] = useState<CmpSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${SERVER}/compare/sessions?limit=200`)
      .then((r) => r.json())
      .then(setSessions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const labeled = sessions.filter((s) => s.user_chosen_id);
  const matchRate = labeled.length
    ? Math.round(labeled.filter((s) => s.user_chosen_id === s.recommended_id).length / labeled.length * 100)
    : null;

  // Vote distribution
  const votes: Record<string, number> = {};
  for (const s of labeled) {
    const k = s.user_chosen_id!;
    votes[k] = (votes[k] || 0) + 1;
  }
  const topSystems = Object.entries(votes).sort((a, b) => b[1] - a[1]).slice(0, 6);

  // Noise distribution
  const noiseDist: Record<string, number> = {};
  for (const s of sessions) {
    const k = s.noise_level || "לא ידוע";
    noiseDist[k] = (noiseDist[k] || 0) + 1;
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "סשנים", value: sessions.length, icon: BarChart3, color: "text-blue-500" },
          { label: "עם משוב", value: labeled.length, icon: CheckCircle2, color: "text-green-500" },
          { label: "דיוק המלצה", value: matchRate !== null ? `${matchRate}%` : "—", icon: TrendingUp, color: "text-primary" },
          { label: "k-NN זמין", value: labeled.length >= 3 ? "✓ כן" : `עוד ${3 - labeled.length}`, icon: Star, color: "text-amber-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color} shrink-0`} />
              <div>
                <div className="text-xl font-bold">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Best systems */}
      {topSystems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500" />
              מערכות שנבחרו כטובות ביותר
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topSystems.map(([id, cnt]) => (
              <div key={id} className="flex items-center gap-3">
                <span className="text-sm font-medium w-36">{id}</span>
                <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full bg-primary/70 rounded-full"
                    style={{ width: `${Math.round((cnt / labeled.length) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground w-12 text-left">{cnt} פעם</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Noise distribution */}
      {Object.keys(noiseDist).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">התפלגות רמות רעש בהקלטות</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(noiseDist).map(([level, cnt]) => (
              <div key={level} className="flex items-center gap-3">
                <span className="text-sm w-24">{level}</span>
                <div className="flex-1 bg-muted rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full bg-amber-500/60 rounded-full"
                    style={{ width: `${Math.round((cnt / sessions.length) * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground w-12 text-left">{cnt}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {sessions.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>עוד לא בוצעו השוואות</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function CompareReport() {
  return (
    <div className="container mx-auto py-6 max-w-5xl space-y-6">
      <div className="flex items-start gap-4">
        <div className="text-4xl select-none" aria-hidden>📊</div>
        <div>
          <h1 className="text-2xl font-bold" dir="rtl">השוואת תמלולים</h1>
          <p className="text-muted-foreground text-sm" dir="rtl">
            12 מערכות מקביל · ניתוח מילה-במילה · דיף חזותי · המלצות מותאמות אישית
          </p>
        </div>
      </div>

      <Tabs defaultValue="run" dir="rtl">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="run" className="gap-2">
            <Play className="w-4 h-4" />
            הרץ השוואה
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="w-4 h-4" />
            היסטוריה
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            סטטיסטיקה
          </TabsTrigger>
        </TabsList>

        <TabsContent value="run" className="mt-6">
          <TabRun />
        </TabsContent>
        <TabsContent value="history" className="mt-6">
          <TabHistory />
        </TabsContent>
        <TabsContent value="stats" className="mt-6">
          <TabStats />
        </TabsContent>
      </Tabs>
    </div>
  );
}
