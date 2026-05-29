import { useState, useRef, useCallback, useEffect } from "react";
import { WaveformPlayer, type WaveformPlayerHandle } from "@/components/WaveformPlayer";
import { TranscriptEditor } from "@/components/TranscriptEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Mic,
  StopCircle,
  Upload,
  BookOpen,
  Settings2,
  GraduationCap,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Download,
  FileText,
  Info,
  Sparkles,
  BarChart3,
  Trophy,
  Target,
  Zap,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Play,
  RefreshCw,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { getServerUrl } from "@/lib/serverConfig";
import { useCloudTranscripts } from "@/hooks/useCloudTranscripts";

const SERVER = getServerUrl();

// ─── Types ────────────────────────────────────────────────────────────────────

interface DictEntry {
  id: number;
  spoken_form: string;
  correct_form: string;
  note: string | null;
  source: string;
  count_applied: number;
  created_at: string;
}

interface GrammarRule {
  id: number;
  name: string;
  pattern: string;
  replacement: string;
  tradition: string;
  enabled: number;
  priority: number;
  created_at: string;
}

interface TranscribeResult {
  text: string;
  raw_text: string;
  words_fixed: number;
  processing_time: number;
  duration: number;
  session_id: string;
  wordTimings?: { word: string; start: number; end: number; probability: number }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts: RequestInit = {}) {
  const r = await fetch(`${SERVER}${path}`, opts);
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error || r.statusText);
  }
  return r.json();
}

// ════════════════════════════════════════════════════════════════════════════
//  TAB 1 — TRANSCRIBE
// ════════════════════════════════════════════════════════════════════════════

function TabTranscribe() {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [inlineEdit, setInlineEdit] = useState<Record<number, { spoken: string; correct: string }>>({});
  const [beamSize, setBeamSize] = useState(5);
  const [normalize, setNormalize] = useState(true);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const audioUrlRef = useRef<string | null>(null);
  const waveformRef = useRef<WaveformPlayerHandle | null>(null);
  const { saveTranscript } = useCloudTranscripts();

  useEffect(() => () => { if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); }, []);

  const transcribe = useCallback(async (file: File) => {
    setIsLoading(true);
    setResult(null);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(file);
    audioUrlRef.current = url;
    setAudioUrl(url);
    setCurrentTime(0);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("beam_size", String(beamSize));
      fd.append("normalize", normalize ? "1" : "0");
      const res = await fetch(`${SERVER}/lk/transcribe`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data: TranscribeResult = await res.json();
      setResult(data);
      // Save transcript + audio to cloud in background
      saveTranscript(
        data.text,
        "לשון הקודש (LK)",
        file.name,
        file,
        data.wordTimings ?? null,
        "lashon-kodesh",
      ).catch(() => {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאת תמלול", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [beamSize, normalize, saveTranscript]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) transcribe(file);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) transcribe(file);
  };

  // Learn word correction from result
  const learnWord = async (spoken: string, correct: string, sessionId: string) => {
    try {
      await apiFetch(`/lk/sessions/${sessionId}/words`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spoken_form: spoken, correct_form: correct }),
      });
      toast({ title: "✓ נלמד", description: `${spoken} → ${correct}` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    }
  };

  const startInlineEdit = (idx: number, spoken: string, correct: string) => {
    setInlineEdit((p) => ({ ...p, [idx]: { spoken, correct } }));
  };

  const saveInlineEdit = async (idx: number, sessionId: string) => {
    const ed = inlineEdit[idx];
    if (!ed) return;
    await learnWord(ed.spoken, ed.correct, sessionId);
    setInlineEdit((p) => { const n = { ...p }; delete n[idx]; return n; });
    // Update displayed result
    if (result) {
      const newWordTimings = result.wordTimings?.map((w, i) =>
        i === idx ? { ...w, word: ed.correct } : w
      );
      const newText = newWordTimings?.map((w) => w.word).join(" ") ?? result.text;
      setResult({ ...result, wordTimings: newWordTimings, text: newText });
    }
  };

  const activeWordIdx = result?.wordTimings
    ? result.wordTimings.findIndex((w) => currentTime >= w.start && currentTime <= w.end)
    : -1;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Settings bar */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap gap-6 items-center">
          <div className="flex items-center gap-2">
            <Label>Beam Size</Label>
            <div className="flex gap-1">
              {[3, 5, 8].map((b) => (
                <Button
                  key={b}
                  size="sm"
                  variant={beamSize === b ? "default" : "outline"}
                  onClick={() => setBeamSize(b)}
                  className="w-10"
                >
                  {b}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={normalize} onCheckedChange={setNormalize} id="lk-norm" />
            <Label htmlFor="lk-norm">נרמול אודיו</Label>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="w-3 h-3" />
            מצב לשון הקודש פעיל
          </Badge>
        </CardContent>
      </Card>

      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/*"
          className="hidden"
          onChange={handleFileChange}
        />
        {isLoading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-muted-foreground">מתמלל בלשון הקודש…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <Upload className="w-10 h-10 text-muted-foreground" />
            <p className="text-lg font-medium">גרור קובץ אודיו / לחץ לבחירה</p>
            <p className="text-sm text-muted-foreground">
              MP3, WAV, M4A, WEBM, MP4 ועוד
            </p>
          </div>
        )}
      </div>

      {/* Result */}
      {result && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">תוצאת תמלול</CardTitle>
              <div className="flex gap-2 text-xs text-muted-foreground">
                <span>{result.processing_time.toFixed(1)}s עיבוד</span>
                <span>·</span>
                <span>{result.duration.toFixed(1)}s אודיו</span>
                {result.words_fixed > 0 && (
                  <>
                    <span>·</span>
                    <Badge variant="secondary" className="text-xs">
                      {result.words_fixed} תיקונים
                    </Badge>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Audio player with word-sync */}
            {audioUrl && (
              <WaveformPlayer
                ref={waveformRef}
                audioSrc={audioUrl}
                wordTimings={result.wordTimings}
                onTimeUpdate={setCurrentTime}
                className="w-full"
              />
            )}
            {/* Corrected text */}
            <div className="p-4 bg-muted/40 rounded-lg text-lg leading-relaxed font-medium">
              {result.text}
            </div>

            {/* Raw vs. corrected diff (if changes) */}
            {result.words_fixed > 0 && result.raw_text !== result.text && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  טקסט גולמי (לפני תיקון)
                </summary>
                <div className="mt-2 p-3 bg-muted/20 rounded text-muted-foreground">
                  {result.raw_text}
                </div>
              </details>
            )}

            {/* Inline word corrections */}
            {result.wordTimings && result.wordTimings.length > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">
                  לחץ על מילה לתיקון ולימוד:
                </p>
                <div className="flex flex-wrap gap-1">
                  {result.wordTimings.map((w, idx) => (
                    <span key={idx}>
                      {inlineEdit[idx] ? (
                        <span className="inline-flex items-center gap-1 bg-primary/10 border border-primary/30 rounded px-1 py-0.5">
                          <Input
                            value={inlineEdit[idx].correct}
                            onChange={(e) =>
                              setInlineEdit((p) => ({
                                ...p,
                                [idx]: { ...p[idx], correct: e.target.value },
                              }))
                            }
                            className="h-6 w-24 text-sm px-1 py-0"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveInlineEdit(idx, result.session_id);
                              if (e.key === "Escape")
                                setInlineEdit((p) => {
                                  const n = { ...p };
                                  delete n[idx];
                                  return n;
                                });
                            }}
                            autoFocus
                          />
                          <button
                            onClick={() => saveInlineEdit(idx, result.session_id)}
                            className="text-green-600 hover:text-green-700"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() =>
                              setInlineEdit((p) => {
                                const n = { ...p };
                                delete n[idx];
                                return n;
                              })
                            }
                            className="text-red-500 hover:text-red-600"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => {
                            startInlineEdit(idx, w.word, w.word);
                            waveformRef.current?.seekTo(w.start);
                          }}
                          className={`px-1 py-0.5 rounded text-sm transition-colors ${
                            idx === activeWordIdx
                              ? "ring-2 ring-primary bg-primary/20 scale-105"
                              : w.probability < 0.6
                              ? "text-orange-500 underline decoration-dotted hover:bg-accent/60"
                              : "hover:bg-accent/60"
                          }`}
                          title={`ביטחון: ${(w.probability * 100).toFixed(0)}%`}
                        >
                          {w.word}
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Copy button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(result.text);
                toast({ title: "הועתק ללוח" });
              }}
            >
              <FileText className="w-4 h-4 ml-1" />
              העתק טקסט
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  TAB 2 — DICTIONARY
// ════════════════════════════════════════════════════════════════════════════

function TabDictionary() {
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [spoken, setSpoken] = useState("");
  const [correct, setCorrect] = useState("");
  const [note, setNote] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/lk/dictionary");
      setEntries(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const save = async () => {
    if (!spoken.trim() || !correct.trim()) {
      toast({ title: "חסר מידע", description: "נדרש טופס מלא", variant: "destructive" });
      return;
    }
    try {
      await apiFetch("/lk/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spoken_form: spoken.trim(), correct_form: correct.trim(), note: note.trim() }),
      });
      setSpoken(""); setCorrect(""); setNote(""); setEditId(null);
      await reload();
      toast({ title: "✓ נשמר" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    }
  };

  const del = async (id: number) => {
    try {
      await apiFetch(`/lk/dictionary/${id}`, { method: "DELETE" });
      await reload();
      toast({ title: "נמחק" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    }
  };

  const startEdit = (e: DictEntry) => {
    setEditId(e.id);
    setSpoken(e.spoken_form);
    setCorrect(e.correct_form);
    setNote(e.note ?? "");
  };

  // CSV import
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split("\n").filter(Boolean);
    let count = 0;
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length < 2) continue;
      const s = parts[0].trim();
      const c = parts[1].trim();
      const n = parts[2]?.trim() ?? "";
      if (s && c) {
        try {
          await apiFetch("/lk/dictionary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ spoken_form: s, correct_form: c, note: n, source: "import" }),
          });
          count++;
        } catch { /* skip duplicates */ }
      }
    }
    await reload();
    toast({ title: `יובאו ${count} רשומות` });
    if (fileRef.current) fileRef.current.value = "";
  };

  const exportCSV = () => {
    const lines = entries.map((e) =>
      `${e.spoken_form},${e.correct_form},${e.note ?? ""}`
    );
    const blob = new Blob(["spoken,correct,note\n" + lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lk_dictionary.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = entries.filter(
    (e) =>
      !filter ||
      e.spoken_form.includes(filter) ||
      e.correct_form.includes(filter) ||
      (e.note ?? "").includes(filter)
  );

  return (
    <div className="space-y-6" dir="rtl">
      {/* Add / Edit form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4" />
            {editId ? "עדכן רשומה" : "הוסף מילה"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>מה Whisper שמע</Label>
              <Input
                placeholder="שבת"
                value={spoken}
                onChange={(e) => setSpoken(e.target.value)}
                dir="rtl"
              />
            </div>
            <div className="space-y-1">
              <Label>מה צריך לכתוב</Label>
              <Input
                placeholder="שבס"
                value={correct}
                onChange={(e) => setCorrect(e.target.value)}
                dir="rtl"
              />
            </div>
            <div className="space-y-1">
              <Label>הערה (אופציונלי)</Label>
              <Input
                placeholder="Ashkenaz tav→sav"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={save}>
              <Check className="w-4 h-4 ml-1" />
              {editId ? "עדכן" : "שמור"}
            </Button>
            {editId && (
              <Button variant="outline" onClick={() => { setEditId(null); setSpoken(""); setCorrect(""); setNote(""); }}>
                ביטול
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Import / Export bar */}
      <div className="flex gap-2 flex-wrap items-center">
        <Input
          placeholder="חיפוש…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-48"
          dir="rtl"
        />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          <Upload className="w-4 h-4 ml-1" />
          ייבוא CSV
        </Button>
        <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleImport} />
        <Button variant="outline" size="sm" onClick={exportCSV}>
          <Download className="w-4 h-4 ml-1" />
          ייצוא CSV
        </Button>
        <Badge variant="outline">{entries.length} רשומות</Badge>
      </div>

      {/* Table */}
      <Card>
        <ScrollArea className="h-[420px]">
          <Table dir="rtl">
            <TableHeader>
              <TableRow>
                <TableHead>מה Whisper שמע</TableHead>
                <TableHead>מה לכתוב</TableHead>
                <TableHead>הערה</TableHead>
                <TableHead>מקור</TableHead>
                <TableHead className="text-center">יושם</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    אין רשומות עדיין
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-sm">{e.spoken_form}</TableCell>
                    <TableCell className="font-semibold text-primary">{e.correct_form}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{e.note}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{e.source}</Badge>
                    </TableCell>
                    <TableCell className="text-center text-sm">{e.count_applied}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(e)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => del(e.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  TAB 3 — GRAMMAR RULES
// ════════════════════════════════════════════════════════════════════════════

function TabRules() {
  const [rules, setRules] = useState<GrammarRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [replacement, setReplacement] = useState("");
  const [priority, setPriority] = useState(10);
  const [editId, setEditId] = useState<number | null>(null);
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch("/lk/rules");
      setRules(data);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const save = async () => {
    if (!name.trim() || !pattern.trim()) {
      toast({ title: "חסר מידע", variant: "destructive" });
      return;
    }
    try {
      await apiFetch("/lk/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), pattern: pattern.trim(), replacement: replacement.trim(), priority }),
      });
      setName(""); setPattern(""); setReplacement(""); setPriority(10); setEditId(null);
      await reload();
      toast({ title: "✓ חוק נשמר" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    }
  };

  const toggle = async (rule: GrammarRule) => {
    try {
      await apiFetch(`/lk/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: rule.enabled ? 0 : 1 }),
      });
      await reload();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    }
  };

  const del = async (id: number) => {
    try {
      await apiFetch(`/lk/rules/${id}`, { method: "DELETE" });
      await reload();
      toast({ title: "חוק נמחק" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    }
  };

  const startEdit = (r: GrammarRule) => {
    setEditId(r.id);
    setName(r.name);
    setPattern(r.pattern);
    setReplacement(r.replacement);
    setPriority(r.priority);
  };

  // Local test
  const runTest = () => {
    if (!testInput) return;
    let out = testInput;
    const enabled = rules.filter((r) => r.enabled);
    for (const r of enabled.sort((a, b) => b.priority - a.priority)) {
      try {
        out = out.replace(new RegExp(r.pattern, "g"), r.replacement);
      } catch { /* skip bad regex */ }
    }
    setTestOutput(out);
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Info box */}
      <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30">
        <CardContent className="pt-4 flex gap-3 text-sm">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
          <span>
            החוקים מוחלים לפי עדיפות (גבוה → נמוך) לפני מילון האישי.
            Pattern הוא ביטוי רגולרי Python. ניתן לבטל חוקים מובנים ולהוסיף חדשים.
          </span>
        </CardContent>
      </Card>

      {/* Add/Edit form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4" />
            {editId ? "ערוך חוק" : "הוסף חוק"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>שם החוק</Label>
              <Input
                placeholder="תו-ללא-דגש → ס"
                value={name}
                onChange={(e) => setName(e.target.value)}
                dir="rtl"
              />
            </div>
            <div className="space-y-1">
              <Label>עדיפות</Label>
              <Input
                type="number"
                min={1}
                max={999}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-24"
              />
            </div>
            <div className="space-y-1">
              <Label>Pattern (regex)</Label>
              <Input
                placeholder="\bשבת\b"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                className="font-mono"
                dir="ltr"
              />
            </div>
            <div className="space-y-1">
              <Label>החלפה</Label>
              <Input
                placeholder="שבס"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                dir="rtl"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={save}>
              <Check className="w-4 h-4 ml-1" />
              {editId ? "עדכן" : "שמור חוק"}
            </Button>
            {editId && (
              <Button variant="outline" onClick={() => { setEditId(null); setName(""); setPattern(""); setReplacement(""); setPriority(10); }}>
                ביטול
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Live tester */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">בדיקת חוקים בזמן אמת</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>טקסט קלט</Label>
              <Textarea
                placeholder="הכנס טקסט לבדיקה…"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                dir="rtl"
                rows={3}
              />
            </div>
            <div className="space-y-1">
              <Label>תוצאה</Label>
              <div className="min-h-[80px] p-3 bg-muted/40 rounded-md text-sm font-medium" dir="rtl">
                {testOutput || <span className="text-muted-foreground">לחץ בדוק…</span>}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={runTest}>
            בדוק
          </Button>
        </CardContent>
      </Card>

      {/* Rules table */}
      <Card>
        <ScrollArea className="h-[400px]">
          <Table dir="rtl">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">פעיל</TableHead>
                <TableHead>שם</TableHead>
                <TableHead>Pattern</TableHead>
                <TableHead>החלפה</TableHead>
                <TableHead className="text-center">עדיפות</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              ) : (
                rules.map((r) => (
                  <TableRow key={r.id} className={!r.enabled ? "opacity-50" : ""}>
                    <TableCell>
                      <Switch
                        checked={!!r.enabled}
                        onCheckedChange={() => toggle(r)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{r.pattern}</TableCell>
                    <TableCell className="text-primary font-medium">{r.replacement}</TableCell>
                    <TableCell className="text-center text-sm">{r.priority}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(r)}>
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => del(r.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </Card>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  TAB 4 — TRAINING
// ════════════════════════════════════════════════════════════════════════════

function TabTraining() {
  // ── Stats ────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({ total: 0, learned: 0, sessions: 0 });
  const [sessions, setSessions] = useState<{ id: number; session_id: string; created_at: string; audio_filename: string; words_fixed: number }[]>([]);
  const { saveTranscript } = useCloudTranscripts();

  // ── Upload + transcribe ──────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<TranscribeResult | null>(null);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [learnedIdxs, setLearnedIdxs] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Waveform player ───────────────────────────────────────────────────────
  const waveformRef = useRef<WaveformPlayerHandle | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  // ── Quick add to dictionary ───────────────────────────────────────────────
  const [qaSpoken, setQaSpoken] = useState("");
  const [qaCorrect, setQaCorrect] = useState("");
  const [qaNote, setQaNote] = useState("");

  // ── Mic single-word training ──────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [targetWord, setTargetWord] = useState("");
  const [micResult, setMicResult] = useState<{ heard: string; correct: string; match: boolean } | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => () => { if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); }, []);

  const loadStats = useCallback(async () => {
    try {
      const [dict, sess] = await Promise.all([
        apiFetch("/lk/dictionary"),
        apiFetch("/lk/sessions?limit=20"),
      ]);
      setStats({
        total: dict.length,
        learned: dict.filter((d: DictEntry) => d.source !== "manual").length,
        sessions: sess.length,
      });
      setSessions(sess.slice(0, 10));
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // ── Upload & transcribe ───────────────────────────────────────────────────
  const transcribeFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setResult(null);
    setLearnedIdxs(new Set());
    setEditIdx(null);
    // create audio URL for player
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(file);
    audioUrlRef.current = url;
    setAudioUrl(url);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("beam_size", "5");
      const res = await fetch(`${SERVER}/lk/transcribe`, { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data: TranscribeResult = await res.json();
      setResult(data);
      setCurrentTime(0);
      // Save transcript + audio to cloud in background
      saveTranscript(
        data.text,
        "לשון הקודש (LK)",
        file.name,
        file,
        data.wordTimings ?? null,
        "lashon-kodesh",
      ).catch(() => {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאת תמלול", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [saveTranscript]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) transcribeFile(file);
  };

  // ── Inline word edit + learn ──────────────────────────────────────────────
  const openEdit = (idx: number, currentWord: string) => {
    setEditIdx(idx);
    setEditValue(currentWord);
  };

  const saveEdit = async (idx: number) => {
    if (!result || !editValue.trim()) { setEditIdx(null); return; }
    const spokenWord = result.wordTimings?.[idx]?.word ?? "";
    const correctForm = editValue.trim();
    if (!spokenWord || spokenWord === correctForm) { setEditIdx(null); return; }
    try {
      // Save to dictionary
      await apiFetch("/lk/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spoken_form: spokenWord, correct_form: correctForm, source: "training" }),
      });
      // Link to session
      if (result.session_id) {
        await apiFetch(`/lk/sessions/${result.session_id}/words`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spoken_form: spokenWord, correct_form: correctForm }),
        }).catch(() => {});
      }
      // Update local word timings
      const newTimings = result.wordTimings?.map((w, i) =>
        i === idx ? { ...w, word: correctForm } : w
      );
      const newText = newTimings?.map((w) => w.word).join(" ") ?? result.text;
      setResult({ ...result, wordTimings: newTimings, text: newText });
      setLearnedIdxs((prev) => new Set([...prev, idx]));
      toast({ title: "✓ נלמד", description: `${spokenWord} → ${correctForm}` });
      loadStats();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    }
    setEditIdx(null);
  };

  // ── Quick add to dictionary ───────────────────────────────────────────────
  const quickAdd = async () => {
    if (!qaSpoken.trim() || !qaCorrect.trim()) {
      toast({ title: "מלא שדות חובה", variant: "destructive" });
      return;
    }
    try {
      await apiFetch("/lk/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spoken_form: qaSpoken.trim(), correct_form: qaCorrect.trim(), note: qaNote.trim(), source: "manual" }),
      });
      toast({ title: "✓ נוסף למילון", description: `${qaSpoken} → ${qaCorrect}` });
      setQaSpoken(""); setQaCorrect(""); setQaNote("");
      loadStats();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    }
  };

  // ── Mic recording ─────────────────────────────────────────────────────────
  const startRecord = async () => {
    if (!targetWord.trim()) { toast({ title: "הכנס מילת יעד", variant: "destructive" }); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `training_${Date.now()}.webm`, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", file);
        fd.append("beam_size", "5");
        try {
          const res = await fetch(`${SERVER}/lk/transcribe`, { method: "POST", body: fd });
          const data = await res.json();
          const heard = (data.raw_text || data.text || "").trim();
          setMicResult({ heard, correct: targetWord.trim(), match: heard === targetWord.trim() });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "שגיאה";
          toast({ title: "שגיאת תמלול", description: msg, variant: "destructive" });
        }
      };
      rec.start();
      mediaRef.current = rec;
      setIsRecording(true);
    } catch { toast({ title: "לא ניתן לגשת למיקרופון", variant: "destructive" }); }
  };

  const stopRecord = () => { mediaRef.current?.stop(); mediaRef.current = null; setIsRecording(false); };

  const learnMicResult = async () => {
    if (!micResult || micResult.match || !micResult.heard) return;
    try {
      await apiFetch("/lk/dictionary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spoken_form: micResult.heard, correct_form: micResult.correct, source: "training" }),
      });
      toast({ title: "✓ נלמד", description: `${micResult.heard} → ${micResult.correct}` });
      setMicResult(null); setTargetWord(""); loadStats();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    }
  };

  // Active word index for player sync
  const activeWordIdx = result?.wordTimings
    ? result.wordTimings.findIndex((w) => currentTime >= w.start && currentTime <= w.end)
    : -1;

  return (
    <div className="space-y-6" dir="rtl">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "מילים במילון", value: stats.total, icon: BookOpen },
          { label: "נלמדו מהקלטות", value: stats.learned, icon: GraduationCap },
          { label: "סשנים", value: stats.sessions, icon: Mic },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="pt-4 flex items-center gap-3">
              <Icon className="w-8 h-8 text-primary/60" />
              <div>
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Upload + Transcribe ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="w-4 h-4" />
            העלה קובץ לתמלול ולימוד
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors"
          >
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) transcribeFile(f); if (fileRef.current) fileRef.current.value = ""; }}
            />
            {isLoading ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <p className="text-muted-foreground">מתמלל…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="w-8 h-8 text-muted-foreground" />
                <p className="font-medium">גרור קובץ אודיו / לחץ לבחירה</p>
                <p className="text-xs text-muted-foreground">MP3, WAV, M4A, WEBM, OPUS</p>
              </div>
            )}
          </div>

          {/* Player */}
          {audioUrl && (
            <WaveformPlayer
              ref={waveformRef}
              audioSrc={audioUrl}
              wordTimings={result?.wordTimings}
              onTimeUpdate={setCurrentTime}
              className="w-full"
            />
          )}

          {/* Clickable word correction grid */}
          {result && result.wordTimings && result.wordTimings.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                לחץ על מילה שגויה לתיקון ולימוד:
                <span className="mr-2 text-xs font-normal text-muted-foreground">
                  מילים <span className="text-orange-500 underline decoration-dotted">מסומנות</span> הן בביטחון נמוך
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5 p-3 bg-muted/30 rounded-lg leading-relaxed">
                {result.wordTimings.map((w, idx) => {
                  const prob = w.probability ?? 1;
                  const isLearned = learnedIdxs.has(idx);
                  const isActive = activeWordIdx === idx;
                  if (editIdx === idx) {
                    return (
                      <span key={idx} className="inline-flex items-center gap-1 bg-primary/10 border border-primary/40 rounded px-1.5 py-0.5">
                        <input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(idx);
                            if (e.key === "Escape") setEditIdx(null);
                          }}
                          className="text-sm bg-transparent border-none outline-none w-24 font-mono"
                          dir="rtl"
                        />
                        <button onClick={() => saveEdit(idx)} className="text-green-600 hover:text-green-700 shrink-0">
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditIdx(null)} className="text-red-500 hover:text-red-600 shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    );
                  }
                  return (
                    <span
                      key={idx}
                      onClick={() => {
                        openEdit(idx, w.word);
                        waveformRef.current?.seekTo(w.start);
                      }}
                      className={[
                        "inline-block px-1.5 py-0.5 rounded cursor-pointer text-sm transition-all select-none",
                        isLearned
                          ? "bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-300 line-through opacity-70"
                          : prob < 0.65
                          ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 underline decoration-dotted hover:bg-red-200"
                          : prob < 0.85
                          ? "bg-orange-100 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 hover:bg-orange-200"
                          : "hover:bg-accent/60",
                        isActive ? "ring-2 ring-primary scale-110 shadow-sm bg-primary/20" : "",
                      ].join(" ")}
                      title={`${Math.round(prob * 100)}% ביטחון${isLearned ? " — נלמד ✓" : " — לחץ לתיקון"}`}
                    >
                      {w.word}
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 dark:bg-red-900/30 inline-block border" /> &lt;65%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-100 dark:bg-orange-900/20 inline-block border" /> 65-85%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded border inline-block" /> &gt;85%</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 inline-block border" /> נלמד</span>
              </div>
              {learnedIdxs.size > 0 && (
                <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                  ✓ {learnedIdxs.size} תיקונים נלמדו ונשמרו במילון
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Quick add to dictionary ─────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="w-4 h-4" />
            הוסף מילה למילון
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>מה Whisper שמע (שגוי)</Label>
              <Input placeholder="שַׁבָּת" value={qaSpoken} onChange={(e) => setQaSpoken(e.target.value)} dir="rtl" />
            </div>
            <div className="space-y-1">
              <Label>מה צריך לכתוב (נכון)</Label>
              <Input placeholder="שַׁבָּס" value={qaCorrect} onChange={(e) => setQaCorrect(e.target.value)} dir="rtl" />
            </div>
            <div className="space-y-1">
              <Label>הערה (אופציונלי)</Label>
              <Input placeholder="Ashkenaz ת→ס" value={qaNote} onChange={(e) => setQaNote(e.target.value)} />
            </div>
          </div>
          <Button onClick={quickAdd} disabled={!qaSpoken.trim() || !qaCorrect.trim()}>
            <Plus className="w-4 h-4 ml-1" />
            הוסף למילון
          </Button>
        </CardContent>
      </Card>

      {/* ── Mic single-word training ────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="w-4 h-4" />
            אמן מילה בודדת במיקרופון
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>מילת יעד — מה תאמר</Label>
            <Input
              placeholder="שַׁבָּס"
              value={targetWord}
              onChange={(e) => setTargetWord(e.target.value)}
              dir="rtl"
              className="text-lg"
            />
          </div>
          <div className="flex gap-2 items-center">
            {isRecording ? (
              <Button variant="destructive" onClick={stopRecord} className="gap-2">
                <StopCircle className="w-4 h-4" />
                עצור הקלטה
              </Button>
            ) : (
              <Button onClick={startRecord} className="gap-2">
                <Mic className="w-4 h-4" />
                הקלט
              </Button>
            )}
            {isRecording && (
              <div className="flex items-center gap-2 text-red-500 text-sm animate-pulse">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                מקליט…
              </div>
            )}
          </div>
          {micResult && (
            <div className={`p-4 rounded-lg border-2 ${micResult.match ? "border-green-400 bg-green-50 dark:bg-green-950/30" : "border-orange-400 bg-orange-50 dark:bg-orange-950/30"}`}>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Whisper שמע:</span>
                  <span className="font-mono font-bold">{micResult.heard || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">יעד:</span>
                  <span className="font-semibold text-primary">{micResult.correct}</span>
                </div>
                <div className="text-center font-bold text-lg">
                  {micResult.match ? "✅ התאמה מושלמת!" : "⚠ אי-התאמה"}
                </div>
                {!micResult.match && micResult.heard && (
                  <Button className="w-full" onClick={learnMicResult}>
                    למד: {micResult.heard} → {micResult.correct}
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sessions table */}
      {sessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">סשנים אחרונים</CardTitle>
          </CardHeader>
          <CardContent>
            <Table dir="rtl">
              <TableHeader>
                <TableRow>
                  <TableHead>תאריך</TableHead>
                  <TableHead>קובץ</TableHead>
                  <TableHead className="text-center">תיקונים</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm text-muted-foreground">{s.created_at?.slice(0, 16) ?? "—"}</TableCell>
                    <TableCell className="text-sm">{s.audio_filename ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={s.words_fixed > 0 ? "default" : "outline"}>{s.words_fixed}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  BENCHMARK TYPES
// ════════════════════════════════════════════════════════════════════════════


interface BenchmarkStats {
  total_sessions: number;
  total_words_fixed: number;
  total_dict_entries: number;
  enabled_rules: number;
  top_corrections: { spoken: string; correct: string; count: number; source: string }[];
  sessions: { date: string; filename: string; words_fixed: number; word_count: number; correction_rate: number }[];
  trend: string;
  trend_label: string;
}

interface BenchmarkRunResult {
  session_id: string;
  raw_text: string;
  corrected_text: string;
  words_fixed: number;
  word_timings: { word: string; start: number; end: number; probability: number }[];
  duration: number;
  processing_time: number;
  rtf: number;
  total_words: number;
  pronunciation_score: number;
  avg_probability: number;
  grade: string;
  grade_color: string;
  weak_words: string[];
  strong_pct: number;
  rules_fired: string[];
  feedback: string;
  tips: string[];
}

// ════════════════════════════════════════════════════════════════════════════
//  HELPERS — score ring SVG
// ════════════════════════════════════════════════════════════════════════════

function ScoreRing({ score, color }: { score: number; color: string }) {
  const r = 15.9;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const strokeColor =
    color === "green" ? "#22c55e" :
    color === "blue" ? "#3b82f6" :
    color === "amber" ? "#f59e0b" : "#ef4444";

  return (
    <svg viewBox="0 0 36 36" className="w-28 h-28 -rotate-90">
      <circle cx="18" cy="18" r={r} fill="none" stroke="#e5e7eb" strokeWidth="3" className="dark:stroke-zinc-700" />
      <circle
        cx="18" cy="18" r={r}
        fill="none"
        stroke={strokeColor}
        strokeWidth="3.5"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
      />
      <text
        x="18" y="21"
        textAnchor="middle"
        className="rotate-90"
        style={{ fill: strokeColor, fontSize: "8px", fontWeight: 700, transform: "rotate(90deg) translate(0, -36px)" }}
      >
        {score}
      </text>
    </svg>
  );
}

function WordConfidenceSpan({ word, prob, corrected }: { word: string; prob: number; corrected?: boolean }) {
  const cls =
    corrected ? "bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 rounded px-0.5 underline decoration-dotted" :
    prob >= 0.85 ? "text-green-700 dark:text-green-400" :
    prob >= 0.65 ? "text-amber-600 dark:text-amber-400" :
    "text-red-600 dark:text-red-400 font-medium";

  return (
    <span
      className={`cursor-default mx-0.5 ${cls}`}
      title={`סמך: ${Math.round(prob * 100)}%${corrected ? " (תוקן)" : ""}`}
    >
      {word}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  TAB 5 — BENCHMARK
// ════════════════════════════════════════════════════════════════════════════

function TabBenchmark() {
  const [stats, setStats] = useState<BenchmarkStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BenchmarkRunResult | null>(null);
  const [beamSize, setBeamSize] = useState(5);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Audio player + sync
  const waveformRef = useRef<WaveformPlayerHandle | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [editedText, setEditedText] = useState("");

  // Cleanup object URL on unmount
  useEffect(() => () => { if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current); }, []);

  const selectFile = useCallback((file: File) => {
    setSelectedFile(file);
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(file);
    audioUrlRef.current = url;
    setAudioUrl(url);
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await apiFetch("/lk/benchmark/stats");
      setStats(data);
    } catch { /* non-critical */ }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const runBenchmark = async (file: File) => {
    setRunning(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("beam_size", String(beamSize));
      const data = await apiFetch("/lk/benchmark/run", { method: "POST", body: fd });
      setResult(data);
      setEditedText(data.corrected_text);
      await loadStats();
      toast({ title: "✓ ניתוח הושלם", description: data.grade });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "שגיאה";
      toast({ title: "שגיאה", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) { selectFile(file); }
  };

  const gradeColors: Record<string, string> = {
    green: "text-green-600 dark:text-green-400",
    blue: "text-blue-600 dark:text-blue-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
  };

  // Active word index for heatmap sync
  const activeWordIdx = result
    ? result.word_timings.findIndex((w) => currentTime >= w.start && currentTime <= w.end)
    : -1;

  // Build a set of words that were corrected for heatmap
  const correctedWords = result ? new Set(
    result.corrected_text.split(" ").filter((w, i) => w !== result.raw_text.split(" ")[i])
  ) : new Set<string>();

  // Max words_fixed for bar chart scale
  const maxFixed = stats?.sessions.length
    ? Math.max(...stats.sessions.map((s) => s.words_fixed), 1)
    : 1;

  return (
    <div className="space-y-6" dir="rtl">

      {/* ── Overview stat cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "סשנים", value: stats?.total_sessions ?? "—", icon: BarChart3, color: "text-blue-500" },
          { label: "מילים תוקנו", value: stats?.total_words_fixed ?? "—", icon: CheckCircle2, color: "text-green-500" },
          { label: "מילון אישי", value: stats?.total_dict_entries ?? "—", icon: BookOpen, color: "text-purple-500" },
          { label: "חוקים פעילים", value: stats?.enabled_rules ?? "—", icon: Zap, color: "text-amber-500" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="hover:shadow-md transition-shadow">
            <CardContent className="pt-4 flex items-center gap-3">
              <Icon className={`w-8 h-8 ${color} shrink-0`} />
              <div>
                <div className="text-2xl font-bold">
                  {statsLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : value}
                </div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend badge */}
      {stats && stats.total_sessions >= 5 && (
        <div className="flex justify-end">
          <Badge variant="outline" className="text-sm px-3 py-1">
            <TrendingUp className="w-3 h-3 ml-1" />
            {stats.trend_label}
          </Badge>
        </div>
      )}

      {/* ── Benchmark runner ────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" />
            הרץ בנצ׳מארק אישי
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drag-drop zone */}
          <div
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
              ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-primary/50"}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              גרור קובץ אודיו לכאן, או לחץ לבחירה
            </p>
            {selectedFile && (
              <p className="mt-2 text-sm font-medium text-primary">{selectedFile.name}</p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,video/*"
              className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) selectFile(e.target.files[0]); }}
            />
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-sm shrink-0">Beam size:</Label>
              <select
                value={beamSize}
                onChange={(e) => setBeamSize(Number(e.target.value))}
                className="text-sm border rounded px-2 py-1 bg-background"
              >
                <option value={1}>1 – מהיר</option>
                <option value={3}>3 – מאוזן</option>
                <option value={5}>5 – מדויק</option>
              </select>
            </div>
            <Button
              onClick={() => { if (selectedFile) runBenchmark(selectedFile); }}
              disabled={!selectedFile || running}
              className="gap-2"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? "מנתח…" : "הרץ ניתוח"}
            </Button>
            {running && (
              <span className="text-sm text-muted-foreground animate-pulse">
                Whisper מעבד, אנא המתן…
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {result && (
        <div className="space-y-5">
          {/* Score header row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Score ring */}
            <Card className="flex flex-col items-center justify-center py-6 col-span-1">
              <div className="relative flex items-center justify-center">
                <svg viewBox="0 0 36 36" className="w-28 h-28">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" className="dark:stroke-zinc-700" />
                  <circle
                    cx="18" cy="18" r="15.9"
                    fill="none"
                    stroke={result.grade_color === "green" ? "#22c55e" : result.grade_color === "blue" ? "#3b82f6" : result.grade_color === "amber" ? "#f59e0b" : "#ef4444"}
                    strokeWidth="3.5"
                    strokeDasharray={`${(result.pronunciation_score / 100) * 99.9} ${99.9 - (result.pronunciation_score / 100) * 99.9}`}
                    strokeLinecap="round"
                    transform="rotate(-90 18 18)"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className={`text-2xl font-black ${gradeColors[result.grade_color]}`}>
                    {result.pronunciation_score}
                  </span>
                  <span className="text-xs text-muted-foreground">/ 100</span>
                </div>
              </div>
              <div className={`text-lg font-bold mt-2 ${gradeColors[result.grade_color]}`}>
                {result.grade}
              </div>
            </Card>

            {/* Breakdown metrics */}
            <div className="col-span-2 grid grid-cols-2 gap-3">
              {[
                { label: "מילות טקסט", value: result.total_words, icon: FileText, sub: "מילים" },
                { label: "תיקונים LK", value: result.words_fixed, icon: CheckCircle2, sub: "תוקנו" },
                { label: "מהירות עיבוד", value: `${result.rtf}x`, icon: Zap, sub: "RTF" },
                { label: "מילים חזקות", value: `${result.strong_pct}%`, icon: Trophy, sub: "ביטחון גבוה" },
              ].map(({ label, value, icon: Icon, sub }) => (
                <Card key={label}>
                  <CardContent className="pt-4 flex items-center gap-3">
                    <Icon className="w-7 h-7 text-primary/60 shrink-0" />
                    <div>
                      <div className="text-xl font-bold">{value}</div>
                      <div className="text-xs text-muted-foreground">{sub}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* WaveformPlayer — synced to word timings */}
          <WaveformPlayer
            ref={waveformRef}
            audioSrc={audioUrl}
            wordTimings={result.word_timings}
            onTimeUpdate={setCurrentTime}
            className="w-full"
          />

          {/* TranscriptEditor — heatmap + editing + export + click-to-seek */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">עריכה ומפת ביטחון</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <TranscriptEditor
                transcript={editedText}
                originalTranscript={result.corrected_text}
                onTranscriptChange={setEditedText}
                wordTimings={result.word_timings}
                onWordClick={(w) => waveformRef.current?.seekTo(w.start)}
                activeWordIdx={activeWordIdx}
              />
            </CardContent>
          </Card>

          {/* Side by side raw / corrected */}
          {result.words_fixed > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Card className="border-muted">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">טקסט גולמי (Whisper)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6" dir="rtl">{result.raw_text || "—"}</p>
                </CardContent>
              </Card>
              <Card className="border-primary/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-primary">טקסט מתוקן (LK)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6" dir="rtl">{result.corrected_text || "—"}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Rules fired */}
          {result.rules_fired.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">חוקים שהופעלו</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {result.rules_fired.map((r, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">{r}</Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {/* System feedback */}
          <Card className="border-blue-200 dark:border-blue-900 bg-gradient-to-br from-blue-50/60 to-transparent dark:from-blue-950/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-500" />
                משוב מהמערכת
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-6" dir="rtl">{result.feedback}</p>

              {/* Weak words list */}
              {result.weak_words.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">מילים לתיאום:</p>
                  <div className="flex flex-wrap gap-2">
                    {result.weak_words.map((w, i) => (
                      <Badge key={i} variant="outline" className="text-red-600 dark:text-red-400 border-red-300">
                        {w}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Tips */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">המלצות:</p>
                {result.tips.map((tip, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span>{tip}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Progress history chart ───────────────────────────────────────── */}
      {(stats?.sessions.length ?? 0) >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              היסטוריית תיקונים
              <span className="text-xs font-normal text-muted-foreground mr-auto">
                גבוה = יותר תיקונים בסשן
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Bar chart */}
            <div className="flex items-end gap-1 h-24 mb-3">
              {[...(stats?.sessions ?? [])].reverse().slice(0, 25).map((s, i) => (
                <div
                  key={i}
                  className="flex-1 bg-primary/50 hover:bg-primary/80 rounded-t transition-colors cursor-default"
                  style={{ height: `${Math.round((s.words_fixed / maxFixed) * 100)}%`, minHeight: s.words_fixed > 0 ? "4px" : "2px" }}
                  title={`${s.date}: ${s.words_fixed} תיקונים מתוך ${s.word_count} מילים`}
                />
              ))}
            </div>

            {/* Recent sessions table */}
            <ScrollArea className="max-h-52">
              <Table dir="rtl">
                <TableHeader>
                  <TableRow>
                    <TableHead>תאריך</TableHead>
                    <TableHead>קובץ</TableHead>
                    <TableHead className="text-center">מילים</TableHead>
                    <TableHead className="text-center">תוקנו</TableHead>
                    <TableHead className="text-center">% תיקון</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats?.sessions.slice(0, 10).map((s, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs text-muted-foreground">{s.date || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[120px] truncate">{s.filename || "—"}</TableCell>
                      <TableCell className="text-center text-sm">{s.word_count}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant={s.words_fixed > 0 ? "default" : "outline"} className="text-xs">
                          {s.words_fixed}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {s.correction_rate}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* ── Personal insights ───────────────────────────────────────────── */}
      {(stats?.top_corrections.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" />
              תיקונים נפוצים — המילון האישי שלך
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table dir="rtl">
              <TableHeader>
                <TableRow>
                  <TableHead>Whisper שמע</TableHead>
                  <TableHead>מה נכון</TableHead>
                  <TableHead className="text-center">פעמים</TableHead>
                  <TableHead>מקור</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats?.top_corrections.slice(0, 10).map((c, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-sm text-muted-foreground">{c.spoken}</TableCell>
                    <TableCell className="font-semibold text-primary">{c.correct}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{c.count}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.source}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!statsLoading && (stats?.total_sessions ?? 0) === 0 && !result && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-3">
            <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground/50" />
            <p className="text-muted-foreground">עדיין לא בוצעו בנצ׳מארקים</p>
            <p className="text-sm text-muted-foreground">העלה קובץ אודיו למעלה כדי להתחיל</p>
          </CardContent>
        </Card>
      )}

      {/* Refresh */}
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={loadStats} disabled={statsLoading} className="gap-1 text-muted-foreground">
          <RefreshCw className={`w-3 h-3 ${statsLoading ? "animate-spin" : ""}`} />
          רענן
        </Button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
//  MAIN PAGE
// ════════════════════════════════════════════════════════════════════════════

export default function LashoKodesh() {
  return (
    <div className="w-full py-6 px-4 md:px-8 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="text-4xl select-none" aria-hidden>📖</div>
        <div>
          <h1 className="text-2xl font-bold" dir="rtl">לשון הקודש</h1>
          <p className="text-muted-foreground text-sm" dir="rtl">
            מערכת תמלול מותאמת להגייה אשכנזית — קריאה, שיעורים, תפילה
          </p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="transcribe" dir="rtl">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="transcribe" className="gap-2">
            <Mic className="w-4 h-4" />
            תמלול
          </TabsTrigger>
          <TabsTrigger value="dictionary" className="gap-2">
            <BookOpen className="w-4 h-4" />
            מילון
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-2">
            <Settings2 className="w-4 h-4" />
            חוקי דקדוק
          </TabsTrigger>
          <TabsTrigger value="training" className="gap-2">
            <GraduationCap className="w-4 h-4" />
            אימון
          </TabsTrigger>
          <TabsTrigger value="benchmark" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            בנצ׳מארק
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transcribe" className="mt-6">
          <TabTranscribe />
        </TabsContent>
        <TabsContent value="dictionary" className="mt-6">
          <TabDictionary />
        </TabsContent>
        <TabsContent value="rules" className="mt-6">
          <TabRules />
        </TabsContent>
        <TabsContent value="training" className="mt-6">
          <TabTraining />
        </TabsContent>
        <TabsContent value="benchmark" className="mt-6">
          <TabBenchmark />
        </TabsContent>
      </Tabs>
    </div>
  );
}
