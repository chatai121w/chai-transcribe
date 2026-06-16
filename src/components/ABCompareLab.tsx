/**
 * ABCompareLab — מעבדת השוואה A/B חיה.
 *
 * המשתמש מעלה אודיו (משותף או נפרד לכל צד), בוחר אילו טוגלי השבחה פעילים
 * בכל צד, ולוחץ "הרץ". המערכת:
 *   1. מחילה עיבוד אודיו מקדים (VAD / AGC) לפי הטוגלים של הצד
 *   2. שולחת לתמלול (Groq / OpenAI) דרך edge function
 *   3. מחילה עיבוד טקסט (לשון הקודש / שמות / תיקונים אישיים / AI)
 *   4. מזריקה את התוצאה ל-Side A או Side B → ה-DiffView הקיים מציג את ההבדל
 */

import { useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FlaskConical, Play, Loader2, Trash2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  getLoshonKodeshReplacements,
  getLoshonKodeshNames,
} from "@/lib/loshonKodesh";
import { applyLearnedCorrections } from "@/utils/correctionLearning";
import { getApiKey } from "@/lib/keyCrypto";

// ── Toggle definitions ──────────────────────────────────────────

type ToggleKey =
  | "vad_trim"
  | "agc_normalize"
  | "loshon_kodesh"
  | "names_dict"
  | "personal_corrections"
  | "ai_polish";

interface ToggleDef {
  key: ToggleKey;
  label: string;
  help: string;
  group: "אודיו" | "טקסט";
}

const TOGGLES: ToggleDef[] = [
  { key: "vad_trim", label: "VAD — חיתוך שתיקות", help: "מסיר שתיקות בתחילה ובסוף", group: "אודיו" },
  { key: "agc_normalize", label: "AGC — נרמול עוצמה", help: "מנרמל את הפיק ל-1-dBFS", group: "אודיו" },
  { key: "loshon_kodesh", label: "לשון הקודש", help: "מחיל החלפות אשכנזיות → תקני", group: "טקסט" },
  { key: "names_dict", label: "מילון שמות פרטיים", help: "מויישע→משה וכו'", group: "טקסט" },
  { key: "personal_corrections", label: "תיקונים אישיים", help: "מודל ההגייה האישי שלך", group: "טקסט" },
  { key: "ai_polish", label: "תיקון AI סופי", help: "Gemini — תיקון שגיאות כתיב/דקדוק", group: "טקסט" },
];

type TogglesState = Record<ToggleKey, boolean>;

const DEFAULT_A: TogglesState = {
  vad_trim: false,
  agc_normalize: false,
  loshon_kodesh: false,
  names_dict: false,
  personal_corrections: false,
  ai_polish: false,
};
const DEFAULT_B: TogglesState = {
  vad_trim: true,
  agc_normalize: true,
  loshon_kodesh: true,
  names_dict: true,
  personal_corrections: true,
  ai_polish: false,
};

const TRANSCRIPTION_SAMPLE_RATE = 16000;
const MAX_TRANSCRIPTION_AUDIO_BYTES = 24 * 1024 * 1024;

// ── Audio helpers (WebAudio) ────────────────────────────────────

async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const arr = await blob.arrayBuffer();
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(arr.slice(0));
  } finally {
    ctx.close().catch(() => {});
  }
}

function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const len = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([out], { type: "audio/wav" });
}

function trimSilence(buffer: AudioBuffer, thresholdDb = -45): AudioBuffer {
  const threshold = Math.pow(10, thresholdDb / 20);
  const len = buffer.length;
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  // Sum of squares per frame across channels
  const isLoud = (i: number) => {
    let s = 0;
    for (let c = 0; c < numCh; c++) s += Math.abs(buffer.getChannelData(c)[i]);
    return s / numCh >= threshold;
  };
  let start = 0;
  while (start < len && !isLoud(start)) start++;
  let end = len - 1;
  while (end > start && !isLoud(end)) end--;
  // Add 100ms padding
  const pad = Math.floor(sr * 0.1);
  start = Math.max(0, start - pad);
  end = Math.min(len - 1, end + pad);
  const newLen = Math.max(1, end - start + 1);
  const Ctx = (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext) as typeof OfflineAudioContext;
  const offline = new Ctx(numCh, newLen, sr);
  const trimmedBuf = offline.createBuffer(numCh, newLen, sr);
  for (let c = 0; c < numCh; c++) {
    trimmedBuf.getChannelData(c).set(buffer.getChannelData(c).subarray(start, start + newLen));
  }
  return trimmedBuf;
}

function normalizePeak(buffer: AudioBuffer, targetDb = -1): AudioBuffer {
  const target = Math.pow(10, targetDb / 20);
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak === 0) return buffer;
  const gain = target / peak;
  if (gain <= 1.001 && gain >= 0.999) return buffer;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) data[i] *= gain;
  }
  return buffer;
}

function downmixAndResample(buffer: AudioBuffer, targetSampleRate = TRANSCRIPTION_SAMPLE_RATE): AudioBuffer {
  const targetLength = Math.max(1, Math.ceil(buffer.duration * targetSampleRate));
  const Ctx = (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext) as typeof OfflineAudioContext;
  const offline = new Ctx(1, targetLength, targetSampleRate);
  const out = offline.createBuffer(1, targetLength, targetSampleRate);
  const outData = out.getChannelData(0);
  const ratio = buffer.sampleRate / targetSampleRate;

  for (let i = 0; i < targetLength; i++) {
    const sourceIndex = i * ratio;
    const i0 = Math.floor(sourceIndex);
    const i1 = Math.min(buffer.length - 1, i0 + 1);
    const frac = sourceIndex - i0;
    let sample = 0;

    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      sample += data[i0] + (data[i1] - data[i0]) * frac;
    }

    outData[i] = sample / buffer.numberOfChannels;
  }

  return out;
}

async function preprocessAudio(blob: Blob, name: string, t: TogglesState): Promise<{ blob: Blob; name: string }> {
  if (!t.vad_trim && !t.agc_normalize) return { blob, name };
  const buf = await decodeAudio(blob);
  let out = buf;
  if (t.vad_trim) out = trimSilence(out);
  if (t.agc_normalize) out = normalizePeak(out);
  const transcriptionReady = downmixAndResample(out);
  const wavBlob = encodeWav(transcriptionReady);
  const base = name.replace(/\.[^.]+$/, "") || "audio";
  if (wavBlob.size > MAX_TRANSCRIPTION_AUDIO_BYTES && blob.size < wavBlob.size) {
    return { blob, name };
  }
  return { blob: wavBlob, name: `${base}.16k.wav` };
}

// ── Text post-processing ────────────────────────────────────────

function applyReplacements(text: string, pairs: { from: string; to: string }[]): string {
  let out = text;
  // Apply longer "from" first to avoid partial overrides
  const sorted = [...pairs].sort((a, b) => b.from.length - a.from.length);
  for (const { from, to } of sorted) {
    if (!from) continue;
    out = out.split(from).join(to);
  }
  return out;
}

async function postProcessText(text: string, t: TogglesState): Promise<string> {
  let out = text;
  if (t.loshon_kodesh) {
    try { out = applyReplacements(out, getLoshonKodeshReplacements()); } catch { /* ignore */ }
  }
  if (t.names_dict) {
    try { out = applyReplacements(out, getLoshonKodeshNames()); } catch { /* ignore */ }
  }
  if (t.personal_corrections) {
    try { out = applyLearnedCorrections(out).text; } catch { /* ignore */ }
  }
  if (t.ai_polish) {
    try {
      // Use Lovable AI Gateway via dedicated edge function — no user API key required
      const { data, error } = await supabase.functions.invoke("ai-polish", {
        body: { text: out },
      });
      if (!error && data && typeof (data as any).text === "string" && (data as any).text.trim()) {
        out = (data as any).text;
      } else if (error) {
        console.warn("[ABLab] ai_polish skipped:", error);
      }
    } catch (e) {
      console.warn("[ABLab] ai_polish error (ignored):", e);
    }
  }
  return out;
}

// ── Transcription call ──────────────────────────────────────────


function getApiKeyFor(engine: "groq" | "openai"): string {
  const storageKey = engine === "groq" ? "groq_api_key" : "openai_api_key";
  try {
    const k = getApiKey(storageKey);
    if (k) return k;
  } catch { /* ignore */ }
  return localStorage.getItem(storageKey) || "";
}

async function transcribe(blob: Blob, fileName: string, engine: "groq" | "openai"): Promise<string> {
  const apiKey = getApiKeyFor(engine);
  if (!apiKey) {
    throw new Error(
      engine === "groq"
        ? "חסר מפתח Groq — הוסף אותו בהגדרות → מפתחות API"
        : "חסר מפתח OpenAI — הוסף אותו בהגדרות → מפתחות API"
    );
  }
  const form = new FormData();
  form.append("file", blob, fileName);
  form.append("language", "he");
  form.append("apiKey", apiKey);
  const slug = engine === "groq" ? "transcribe-groq" : "transcribe-openai";
  const { data, error } = await supabase.functions.invoke(slug, { body: form });
  if (error) throw new Error(error.message || "transcription failed");
  const txt = (data as any)?.text || (data as any)?.transcription || "";
  if (typeof txt !== "string") throw new Error("Empty transcription");
  return txt;
}

// ── Component ───────────────────────────────────────────────────

interface Props {
  onResult: (side: "A" | "B", label: string, text: string) => void;
  onAudio: (side: "A" | "B", blob: Blob, name: string) => void;
}

export function ABCompareLab({ onResult, onAudio }: Props) {
  const [sharedAudio, setSharedAudio] = useState<{ blob: Blob; name: string } | null>(null);
  const [audioA, setAudioA] = useState<{ blob: Blob; name: string } | null>(null);
  const [audioB, setAudioB] = useState<{ blob: Blob; name: string } | null>(null);
  const [useShared, setUseShared] = useState(true);
  const [engine, setEngine] = useState<"groq" | "openai">("groq");
  const [togglesA, setTogglesA] = useState<TogglesState>(DEFAULT_A);
  const [togglesB, setTogglesB] = useState<TogglesState>(DEFAULT_B);
  const [runningA, setRunningA] = useState(false);
  const [runningB, setRunningB] = useState(false);
  const [progressA, setProgressA] = useState<{ pct: number; stage: string }>({ pct: 0, stage: "" });
  const [progressB, setProgressB] = useState<{ pct: number; stage: string }>({ pct: 0, stage: "" });
  const sharedInputRef = useRef<HTMLInputElement>(null);
  const aInputRef = useRef<HTMLInputElement>(null);
  const bInputRef = useRef<HTMLInputElement>(null);

  const setToggle = (side: "A" | "B", key: ToggleKey, v: boolean) => {
    if (side === "A") setTogglesA(prev => ({ ...prev, [key]: v }));
    else setTogglesB(prev => ({ ...prev, [key]: v }));
  };

  const audioFor = (side: "A" | "B") => (useShared ? sharedAudio : side === "A" ? audioA : audioB);

  const handleRun = async (side: "A" | "B") => {
    const audio = audioFor(side);
    if (!audio) {
      toast({ title: "אין אודיו", description: `צד ${side}: העלה קובץ קודם`, variant: "destructive" });
      return;
    }
    const toggles = side === "A" ? togglesA : togglesB;
    const setRunning = side === "A" ? setRunningA : setRunningB;
    const setProgress = side === "A" ? setProgressA : setProgressB;
    const updateProgress = (pct: number, stage: string) => setProgress({ pct, stage });

    setRunning(true);
    updateProgress(2, "מתחיל…");

    // Simulated progress ticker during the long transcription step
    let tickerStop = false;
    const startTicker = (from: number, to: number, durationMs: number, stage: string) => {
      const startedAt = Date.now();
      const tick = () => {
        if (tickerStop) return;
        const elapsed = Date.now() - startedAt;
        const ratio = Math.min(1, elapsed / durationMs);
        const pct = from + (to - from) * ratio;
        setProgress({ pct, stage });
        if (ratio < 1) setTimeout(tick, 250);
      };
      tick();
    };

    try {
      onAudio(side, audio.blob, audio.name);
      updateProgress(8, "מעבד אודיו…");
      const pre = await preprocessAudio(audio.blob, audio.name, toggles);

      updateProgress(20, "שולח לתמלול…");
      // Estimate transcription duration ~ 1s per 100KB, min 4s, max 120s
      const estMs = Math.min(120000, Math.max(4000, pre.blob.size / 100));
      startTicker(20, 75, estMs, "מתמלל…");
      const raw = await transcribe(pre.blob, pre.name, engine);
      tickerStop = true;

      updateProgress(80, toggles.ai_polish ? "תיקון AI…" : "מסיים…");
      const finalText = await postProcessText(raw, toggles);

      updateProgress(95, "מציג תוצאה…");
      const activeKeys = TOGGLES.filter(t => toggles[t.key]).map(t => t.label);
      const label = activeKeys.length === 0
        ? `${engine} · ללא השבחות`
        : `${engine} · ${activeKeys.join(" + ")}`;

      onResult(side, label, finalText);
      updateProgress(100, "הסתיים ✓");
      toast({ title: `הסתיים — צד ${side}`, description: `${finalText.length} תווים` });
    } catch (e) {
      tickerStop = true;
      updateProgress(0, "");
      toast({
        title: `שגיאה — צד ${side}`,
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      tickerStop = true;
      setRunning(false);
      // Clear bar after a short delay so user sees the "done" state
      setTimeout(() => setProgress({ pct: 0, stage: "" }), 2500);
    }
  };

  const handleRunBoth = async () => {
    await Promise.all([handleRun("A"), handleRun("B")]);
  };

  const FilePicker = ({
    label,
    value,
    onPick,
    onClear,
    inputRef,
  }: {
    label: string;
    value: { name: string } | null;
    onPick: (blob: Blob, name: string) => void;
    onClear: () => void;
    inputRef: React.RefObject<HTMLInputElement>;
  }) => (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f, f.name);
          e.target.value = "";
        }}
      />
      <Button variant="outline" size="sm" className="gap-1 h-8" onClick={() => inputRef.current?.click()}>
        <Upload className="h-3.5 w-3.5" />
        {label}
      </Button>
      {value && (
        <>
          <span className="text-xs text-muted-foreground truncate max-w-[200px]">{value.name}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClear} title="נקה">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );

  const renderToggles = (side: "A" | "B") => {
    const state = side === "A" ? togglesA : togglesB;
    const audio = "אודיו";
    const text = "טקסט";
    return (
      <div className="space-y-3">
        {[audio, text].map(group => (
          <div key={group}>
            <div className="text-[11px] font-semibold text-muted-foreground mb-1">{group}</div>
            <div className="space-y-1.5">
              {TOGGLES.filter(t => t.group === group).map(t => (
                <label
                  key={t.key}
                  className="flex items-start gap-2 text-xs cursor-pointer hover:bg-muted/40 rounded p-1.5"
                  title={t.help}
                >
                  <Checkbox
                    checked={state[t.key]}
                    onCheckedChange={(v) => setToggle(side, t.key, Boolean(v))}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <div className="font-medium leading-tight">{t.label}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight">{t.help}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card className="p-4 space-y-4 border-primary/30 bg-primary/5" dir="rtl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-sm font-bold">מעבדת A/B — תמלל ובדוק אם השבחה באמת עוזרת</h2>
            <p className="text-[11px] text-muted-foreground">
              העלה אודיו, סמן טוגלים בכל צד, ולחץ "הרץ" — תראה את ההבדל בתוצאות.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="lab-engine" className="text-xs">מנוע:</Label>
            <Select value={engine} onValueChange={(v) => setEngine(v as "groq" | "openai")}>
              <SelectTrigger id="lab-engine" className="h-8 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="groq">Groq Whisper</SelectItem>
                <SelectItem value="openai">OpenAI Whisper</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 bg-background">
            <Label htmlFor="lab-shared" className="text-xs cursor-pointer">אותו אודיו לשני הצדדים</Label>
            <Switch id="lab-shared" checked={useShared} onCheckedChange={setUseShared} />
          </div>
        </div>
      </div>

      {/* Audio inputs */}
      <div className="rounded-md bg-background/60 p-3 border">
        {useShared ? (
          <FilePicker
            label="העלה אודיו"
            value={sharedAudio}
            onPick={(blob, name) => setSharedAudio({ blob, name })}
            onClear={() => setSharedAudio(null)}
            inputRef={sharedInputRef}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Badge variant="default" className="mb-1">A</Badge>
              <FilePicker
                label="אודיו A"
                value={audioA}
                onPick={(blob, name) => setAudioA({ blob, name })}
                onClear={() => setAudioA(null)}
                inputRef={aInputRef}
              />
            </div>
            <div>
              <Badge variant="secondary" className="mb-1">B</Badge>
              <FilePicker
                label="אודיו B"
                value={audioB}
                onPick={(blob, name) => setAudioB({ blob, name })}
                onClear={() => setAudioB(null)}
                inputRef={bInputRef}
              />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {(["A", "B"] as const).map(side => {
          const running = side === "A" ? runningA : runningB;
          const prog = side === "A" ? progressA : progressB;
          return (
            <div key={side} className="rounded-md border p-3 bg-background/60 space-y-2">
              <div className="flex items-center justify-between">
                <Badge variant={side === "A" ? "default" : "secondary"}>{side}</Badge>
                <Button
                  size="sm"
                  className="h-8 gap-1"
                  onClick={() => handleRun(side)}
                  disabled={running || !audioFor(side)}
                >
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  הרץ {side}
                </Button>
              </div>
              {(running || prog.pct > 0) && (
                <div className="space-y-1">
                  <Progress value={prog.pct} className="h-2" />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{prog.stage}</span>
                    <span>{Math.round(prog.pct)}%</span>
                  </div>
                </div>
              )}
              {renderToggles(side)}
            </div>
          );
        })}
      </div>

      <div className="flex justify-center">
        <Button
          variant="default"
          className="gap-2"
          onClick={handleRunBoth}
          disabled={runningA || runningB || (!audioFor("A") || !audioFor("B"))}
        >
          {(runningA || runningB) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          הרץ את שניהם
        </Button>
      </div>
    </Card>
  );
}
