import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import {
  enhanceAudioOnServer,
  fetchAiEnhanceStatus,
  type AiEnhanceStatus,
  type EnhancementPreset,
  type EnhancementOutputFormat,
} from "@/lib/audioEnhancement";

/* ─── lazy RNNoise singleton ─────────────────────────────── */
let _rnnoiseModule: typeof import("@shiguredo/rnnoise-wasm") | null = null;
let _rnnoiseInstance: Awaited<ReturnType<typeof import("@shiguredo/rnnoise-wasm").Rnnoise.load>> | null = null;
let _rnnoiseLoading: Promise<void> | null = null;

/** Pre-warm: begin downloading the 4.7 MB WASM in the background */
function preWarmRnnoise() {
  if (_rnnoiseLoading || _rnnoiseInstance) return;
  _rnnoiseLoading = (async () => {
    _rnnoiseModule = await import("@shiguredo/rnnoise-wasm");
    _rnnoiseInstance = await _rnnoiseModule.Rnnoise.load();
  })();
}

async function getRnnoise() {
  if (_rnnoiseInstance) return _rnnoiseInstance;
  if (!_rnnoiseLoading) preWarmRnnoise();
  await _rnnoiseLoading;
  return _rnnoiseInstance!;
}

import {
  AudioLines,
  Brain,
  CheckCircle2,
  ChevronRight,
  Download,
  FileAudio,
  Filter,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Sparkles,
  UploadCloud,
  Volume2,
  Waves,
  Wand2,
  Zap,
  AlertTriangle,
  Settings2,
  Layers,
  ArrowDown,
} from "lucide-react";

/* ─── types ────────────────────────────────────────────────── */

type PipelineStage = "idle" | "converting" | "vad" | "denoise" | "eq" | "normalize" | "ai" | "done" | "error";
type TrackId = "original" | "cleaned";

interface StageResult {
  label: string;
  blob: Blob | null;
  url: string | null;
  durationMs: number;
}

/* ─── constants ────────────────────────────────────────────── */

const AI_PRESETS: { id: EnhancementPreset; label: string; desc: string; icon: typeof Brain }[] = [
  { id: "ai_hebrew", label: "AI עברית", desc: "MetricGAN-U + EQ ממוקד עברית", icon: Brain },
  { id: "ai_full", label: "AI מלא", desc: "ניקוי + שיפור + נורמליזציה מלאה", icon: Sparkles },
  { id: "ai_enhance", label: "שיפור דיבור", desc: "שיפור בהירות קול בלבד", icon: Mic },
  { id: "ai_denoise", label: "ניקוי רעש AI", desc: "ניקוי ספקטרלי מבוסס AI", icon: Shield },
  { id: "clean", label: "ניקוי קלאסי", desc: "FFmpeg HP+LP+Compressor", icon: Filter },
  { id: "podcast", label: "פודקאסט", desc: "FFmpeg שרשרת מקצועית", icon: AudioLines },
];

const OUTPUT_FORMATS: { id: EnhancementOutputFormat; label: string }[] = [
  { id: "mp3", label: "MP3" },
  { id: "opus", label: "Opus" },
  { id: "aac", label: "AAC" },
];

/* ─── helpers ──────────────────────────────────────────────── */

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const length = samples.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/* ─── RNNoise browser processing ──────────────────────────── */

async function processRnnoise(file: File): Promise<Blob> {
  const rnnoise = await getRnnoise();
  const denoiseState = rnnoise.createDenoiseState();
  const FRAME_SIZE = rnnoise.frameSize;
  const arrayBuf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const decoded = await ctx.decodeAudioData(arrayBuf);
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * 48000), 48000);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  const samples = rendered.getChannelData(0);
  const output = new Float32Array(samples.length);
  const frame = new Float32Array(FRAME_SIZE);
  for (let offset = 0; offset < samples.length; offset += FRAME_SIZE) {
    const remaining = samples.length - offset;
    const len = Math.min(FRAME_SIZE, remaining);
    frame.fill(0);
    for (let i = 0; i < len; i++) frame[i] = samples[offset + i] * 32768.0;
    denoiseState.processFrame(frame);
    for (let i = 0; i < len; i++) output[offset + i] = frame[i] / 32768.0;
  }
  denoiseState.destroy();
  return encodeWav(output, 48000);
}

/* ─── browser EQ + optional normalize in ONE pass ─────────── */

async function applyBrowserEQAndNormalize(
  file: File,
  hpFreq: number,
  lpFreq: number,
  boostPresence: boolean,
  normalize: boolean,
  targetDb: number,
): Promise<Blob> {
  const arrayBuf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const decoded = await ctx.decodeAudioData(arrayBuf);
  const totalSamples = Math.ceil(decoded.duration * 48000);
  const offlineCtx = new OfflineAudioContext(1, totalSamples, 48000);

  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;

  // HP filter
  const hp = offlineCtx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = hpFreq;
  hp.Q.value = 0.707;

  // LP filter
  const lp = offlineCtx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = lpFreq;
  lp.Q.value = 0.707;

  source.connect(hp);
  hp.connect(lp);

  let lastNode: AudioNode = lp;

  if (boostPresence) {
    const presence = offlineCtx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 3000;
    presence.Q.value = 1.0;
    presence.gain.value = 3;
    lp.connect(presence);

    const warmth = offlineCtx.createBiquadFilter();
    warmth.type = "peaking";
    warmth.frequency.value = 250;
    warmth.Q.value = 0.8;
    warmth.gain.value = 2;
    presence.connect(warmth);
    lastNode = warmth;
  }

  // Gain node for normalization (applied after rendering if needed)
  lastNode.connect(offlineCtx.destination);
  source.start();

  const rendered = await offlineCtx.startRendering();
  const samples = rendered.getChannelData(0);

  if (normalize) {
    // RMS normalization in the same pass — no extra decode
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
    const rms = Math.sqrt(sumSq / samples.length);
    const currentDb = 20 * Math.log10(rms + 1e-10);
    const gain = Math.pow(10, (targetDb - currentDb) / 20);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.max(-1, Math.min(1, samples[i] * gain));
    }
  }

  return encodeWav(samples, 48000);
}

/* ─── component ────────────────────────────────────────────── */

export default function AudioCleanLab() {
  /* ── file state ── */
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /* ── pipeline config ── */
  const [enableDenoise, setEnableDenoise] = useState(true);
  const [enableEQ, setEnableEQ] = useState(true);
  const [enableNormalize, setEnableNormalize] = useState(true);
  const [enableAI, setEnableAI] = useState(false);
  const [aiPreset, setAiPreset] = useState<EnhancementPreset>("ai_hebrew");
  const [outputFormat, setOutputFormat] = useState<EnhancementOutputFormat>("mp3");
  const [hpFreq, setHpFreq] = useState(80);
  const [lpFreq, setLpFreq] = useState(12000);
  const [boostPresence, setBoostPresence] = useState(true);
  const [targetDb, setTargetDb] = useState(-20);

  /* ── pipeline state ── */
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [progress, setProgress] = useState(0);
  const [stageResults, setStageResults] = useState<StageResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Resume support: track which stages completed + last good blob
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());
  const lastGoodBlobRef = useRef<Blob | null>(null);

  /* ── server status ── */
  const [aiStatus, setAiStatus] = useState<AiEnhanceStatus | null>(null);

  /* ── playback ── */
  const [activeTrack, setActiveTrack] = useState<TrackId>("original");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const originalAudioRef = useRef<HTMLAudioElement | null>(null);
  const cleanedAudioRef = useRef<HTMLAudioElement | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null);
  const animFrameRef = useRef<number>(0);

  /* ── fetch AI status on mount ── */
  useEffect(() => {
    fetchAiEnhanceStatus().then(setAiStatus).catch(() => {});
  }, []);

  /* ── cleanup URLs ── */
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
      stageResults.forEach(r => { if (r.url) URL.revokeObjectURL(r.url); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── file handling ── */
  const handleFile = useCallback((f: File) => {
    // Pre-warm RNNoise WASM in background while user configures
    preWarmRnnoise();

    // Revoke old URLs
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
    stageResults.forEach(r => { if (r.url) URL.revokeObjectURL(r.url); });

    setFile(f);
    const url = URL.createObjectURL(f);
    setOriginalUrl(url);
    setCleanedUrl(null);
    setStageResults([]);
    setPipelineStage("idle");
    setProgress(0);
    setError(null);
    setCompletedStages(new Set());
    lastGoodBlobRef.current = null;
    setIsPlaying(false);
    setCurrentTime(0);
    setActiveTrack("original");
    toast({ title: "קובץ נטען", description: `${f.name} (${formatBytes(f.size)})` });
  }, [originalUrl, cleanedUrl, stageResults]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("audio/")) handleFile(f);
  }, [handleFile]);

  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  }, [handleFile]);

  /* ── pipeline execution (parallel where possible, resumes on retry) ── */
  const runPipeline = useCallback(async () => {
    if (!file) return;
    const ac = new AbortController();
    abortRef.current = ac;

    // Resume mode: if we have completed stages, keep them and continue
    const isResuming = completedStages.size > 0 && lastGoodBlobRef.current !== null;
    const resumeResults = isResuming ? [...stageResults] : [];

    setPipelineStage("converting");
    setProgress(5);
    setError(null);
    if (!isResuming) {
      setStageResults([]);
      setCleanedUrl(null);
      setCompletedStages(new Set());
      lastGoodBlobRef.current = null;
    }
    setIsPlaying(false);

    const results: StageResult[] = [...resumeResults];

    try {
      /* ── kick off AI server in background (it's the slowest stage) ── */
      let aiPromise: Promise<{ blob: Blob; elapsed: number }> | null = null;
      if (enableAI && !completedStages.has("ai") && !ac.signal.aborted) {
        aiPromise = (async () => {
          const t0 = performance.now();
          const result = await enhanceAudioOnServer(file, {
            preset: aiPreset,
            outputFormat,
            signal: ac.signal,
          });
          return { blob: result.blob, elapsed: performance.now() - t0 };
        })();
      }

      /* ── browser stages run sequentially (each depends on previous output) ── */
      let currentBlob: Blob = isResuming ? lastGoodBlobRef.current! : file;
      const done = completedStages;

      // Stage 1: RNNoise denoise
      if (enableDenoise && !done.has("denoise") && !ac.signal.aborted) {
        setPipelineStage("denoise");
        setProgress(15);
        const t0 = performance.now();
        const denoised = await processRnnoise(
          new File([currentBlob], file.name, { type: currentBlob.type || "audio/wav" }),
        );
        const elapsed = performance.now() - t0;
        const url = URL.createObjectURL(denoised);
        results.push({ label: "ניקוי רעש (RNNoise)", blob: denoised, url, durationMs: elapsed });
        currentBlob = denoised;
        lastGoodBlobRef.current = denoised;
        setCompletedStages(prev => new Set(prev).add("denoise"));
        setStageResults([...results]);
        setProgress(35);
      } else if (done.has("denoise")) {
        setProgress(35);
      }

      // Stage 2+3: EQ + Normalize in single pass (saves one decode cycle)
      const eqNormKey = enableEQ ? "eq" : "normalize";
      if ((enableEQ || enableNormalize) && !done.has(eqNormKey) && !ac.signal.aborted) {
        setPipelineStage(enableEQ ? "eq" : "normalize");
        setProgress(enableEQ ? 40 : 60);

        if (enableEQ) {
          const t0 = performance.now();
          const combined = await applyBrowserEQAndNormalize(
            new File([currentBlob], "stage.wav", { type: "audio/wav" }),
            hpFreq, lpFreq, boostPresence,
            enableNormalize, targetDb,
          );
          const elapsed = performance.now() - t0;
          const url = URL.createObjectURL(combined);
          const label = enableNormalize
            ? `EQ (HP ${hpFreq}Hz / LP ${lpFreq}Hz) + נורמליזציה (${targetDb}dB)`
            : `EQ (HP ${hpFreq}Hz / LP ${lpFreq}Hz)`;
          results.push({ label, blob: combined, url, durationMs: elapsed });
          currentBlob = combined;
        } else {
          // Normalize only — lightweight single-pass
          setPipelineStage("normalize");
          setProgress(60);
          const t0 = performance.now();
          const normBlob = await applyBrowserEQAndNormalize(
            new File([currentBlob], "stage.wav", { type: "audio/wav" }),
            20, 20000, false,   // passthrough EQ
            true, targetDb,
          );
          const elapsed = performance.now() - t0;
          const url = URL.createObjectURL(normBlob);
          results.push({ label: `נורמליזציה (${targetDb} dB)`, blob: normBlob, url, durationMs: elapsed });
          currentBlob = normBlob;
        }
        lastGoodBlobRef.current = currentBlob;
        setCompletedStages(prev => new Set(prev).add(eqNormKey));
        setStageResults([...results]);
        setProgress(70);
      } else if (done.has(eqNormKey)) {
        setProgress(70);
      }

      // Stage 4: Wait for AI server result (already running in background)
      if (aiPromise && !ac.signal.aborted) {
        setPipelineStage("ai");
        setProgress(75);
        const aiResult = await aiPromise;
        const url = URL.createObjectURL(aiResult.blob);
        const presetLabel = AI_PRESETS.find(p => p.id === aiPreset)?.label || aiPreset;
        results.push({ label: `AI שיפור (${presetLabel})`, blob: aiResult.blob, url, durationMs: aiResult.elapsed });
        currentBlob = aiResult.blob;
        lastGoodBlobRef.current = currentBlob;
        setCompletedStages(prev => new Set(prev).add("ai"));
        setStageResults([...results]);
        setProgress(95);
      } else if (done.has("ai")) {
        setProgress(95);
      }

      // Done — clear resume state
      setStageResults(results);
      const finalUrl = URL.createObjectURL(currentBlob);
      setCleanedUrl(finalUrl);
      setPipelineStage("done");
      setProgress(100);
      setCompletedStages(new Set());
      lastGoodBlobRef.current = null;
      setActiveTrack("cleaned");
      toast({
        title: "Pipeline הושלם!",
        description: `${results.length} שלבים עובדו בהצלחה`,
      });
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "שגיאה לא צפויה";
      setError(msg);
      setPipelineStage("error");
      // Save partial results so we can resume
      setStageResults(results);
      if (lastGoodBlobRef.current) {
        setCleanedUrl(URL.createObjectURL(lastGoodBlobRef.current));
      }
      toast({ title: "שגיאה ב-Pipeline", description: msg, variant: "destructive" });
    }
  }, [file, enableDenoise, enableEQ, enableNormalize, enableAI, aiPreset, outputFormat, hpFreq, lpFreq, boostPresence, targetDb, completedStages, stageResults]);

  const cancelPipeline = useCallback(() => {
    abortRef.current?.abort();
    setPipelineStage("idle");
    setProgress(0);
    setCompletedStages(new Set());
    lastGoodBlobRef.current = null;
  }, []);

  /* ── playback ── */
  const getActiveAudio = useCallback(() => {
    return activeTrack === "original" ? originalAudioRef.current : cleanedAudioRef.current;
  }, [activeTrack]);

  const togglePlay = useCallback(() => {
    const audio = getActiveAudio();
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      // Pause the other track
      const other = activeTrack === "original" ? cleanedAudioRef.current : originalAudioRef.current;
      if (other) other.pause();
      audio.play();
      setIsPlaying(true);
    }
  }, [isPlaying, getActiveAudio, activeTrack]);

  const switchTrack = useCallback((track: TrackId) => {
    const wasPaused = !isPlaying;
    const currentAudio = getActiveAudio();
    const pos = currentAudio?.currentTime || 0;

    if (currentAudio) currentAudio.pause();
    setActiveTrack(track);
    setIsPlaying(false);

    requestAnimationFrame(() => {
      const next = track === "original" ? originalAudioRef.current : cleanedAudioRef.current;
      if (next) {
        next.currentTime = pos;
        if (!wasPaused) {
          next.play();
          setIsPlaying(true);
        }
      }
    });
  }, [isPlaying, getActiveAudio]);

  // RAF for time updates
  useEffect(() => {
    const tick = () => {
      const audio = activeTrack === "original" ? originalAudioRef.current : cleanedAudioRef.current;
      if (audio) {
        setCurrentTime(audio.currentTime);
        if (!isNaN(audio.duration)) setDuration(audio.duration);
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [activeTrack]);

  const seek = useCallback((pct: number) => {
    const audio = getActiveAudio();
    if (audio && !isNaN(audio.duration)) {
      audio.currentTime = (pct / 100) * audio.duration;
      setCurrentTime(audio.currentTime);
    }
  }, [getActiveAudio]);

  /* ── download ── */
  const downloadCleaned = useCallback(() => {
    if (!cleanedUrl || !file) return;
    const a = document.createElement("a");
    a.href = cleanedUrl;
    const ext = enableAI ? (outputFormat === "aac" ? "m4a" : outputFormat) : "wav";
    a.download = file.name.replace(/\.[^/.]+$/, "") + `.cleaned.${ext}`;
    a.click();
  }, [cleanedUrl, file, enableAI, outputFormat]);

  /* ── reset ── */
  const reset = useCallback(() => {
    abortRef.current?.abort();
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
    stageResults.forEach(r => { if (r.url) URL.revokeObjectURL(r.url); });
    setFile(null);
    setOriginalUrl(null);
    setCleanedUrl(null);
    setStageResults([]);
    setPipelineStage("idle");
    setProgress(0);
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setActiveTrack("original");
  }, [originalUrl, cleanedUrl, stageResults]);

  /* ── stage label helper ── */
  const stageLabel: Record<PipelineStage, string> = {
    idle: "ממתין",
    converting: "ממיר פורמט...",
    vad: "מזהה דיבור (VAD)...",
    denoise: "מנקה רעשים (RNNoise)...",
    eq: "מפעיל EQ...",
    normalize: "מנרמל עוצמה...",
    ai: "שיפור AI (שרת)...",
    done: "הושלם!",
    error: "שגיאה",
  };

  const isRunning = pipelineStage !== "idle" && pipelineStage !== "done" && pipelineStage !== "error";

  /* ─── render ─────────────────────────────────────────────── */
  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Wand2 className="w-7 h-7 text-purple-500" />
        <h1 className="text-2xl font-bold">מעבדת ניקוי קול</h1>
        <Badge variant="secondary" className="gap-1">
          <Layers className="w-3 h-3" /> Pipeline
        </Badge>
        {aiStatus?.available && (
          <Badge variant="outline" className="gap-1 text-green-600 border-green-300">
            <Zap className="w-3 h-3" /> AI זמין
            {aiStatus.engines.gpu && ` • GPU ${aiStatus.engines.gpu_name || "CUDA"}`}
          </Badge>
        )}
        {aiStatus?.available && !aiStatus.engines.gpu && (
          <Badge variant="outline" className="gap-1 text-yellow-600 border-yellow-300">
            <AlertTriangle className="w-3 h-3" /> CPU בלבד — GPU לא זמין
          </Badge>
        )}
      </div>

      <Tabs defaultValue="pipeline" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="pipeline" className="gap-1"><Layers className="w-4 h-4" /> Pipeline</TabsTrigger>
          <TabsTrigger value="compare" className="gap-1"><AudioLines className="w-4 h-4" /> השוואה A/B</TabsTrigger>
          <TabsTrigger value="info" className="gap-1"><Settings2 className="w-4 h-4" /> מידע</TabsTrigger>
        </TabsList>

        {/* ═══ TAB 1: Pipeline ═══ */}
        <TabsContent value="pipeline" className="space-y-4 mt-4">
          {/* Upload area */}
          {!file ? (
            <Card
              className={`border-2 border-dashed transition-colors cursor-pointer ${dragActive ? "border-purple-500 bg-purple-500/5" : "border-muted-foreground/25 hover:border-purple-400"}`}
              onDragOver={e => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
                <UploadCloud className="w-12 h-12 text-muted-foreground" />
                <p className="text-lg font-medium">גרור קובץ אודיו או לחץ לבחירה</p>
                <p className="text-sm text-muted-foreground">WAV, MP3, WebM, OGG, M4A</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={onPickFile}
                />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* File info bar */}
              <Card>
                <CardContent className="flex items-center gap-3 py-3 flex-wrap">
                  <FileAudio className="w-5 h-5 text-purple-500" />
                  <span className="font-medium">{file.name}</span>
                  <Badge variant="outline">{formatBytes(file.size)}</Badge>
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <RotateCcw className="w-4 h-4 ml-1" /> קובץ חדש
                  </Button>
                </CardContent>
              </Card>

              <div className="grid md:grid-cols-[1fr_300px] gap-4">
                {/* Left: Pipeline steps config */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Settings2 className="w-5 h-5" /> הגדרות Pipeline
                    </CardTitle>
                    <CardDescription>בחר את שלבי העיבוד והגדר פרמטרים</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Step 1: Denoise */}
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
                      <div className="flex items-center gap-3">
                        <Badge className="bg-blue-500 text-white w-6 h-6 flex items-center justify-center p-0 rounded-full">1</Badge>
                        <Shield className="w-5 h-5 text-blue-500" />
                        <div>
                          <p className="font-medium text-sm">ניקוי רעש (RNNoise)</p>
                          <p className="text-xs text-muted-foreground">רשת נוירונים — מסיר רעש רקע קבוע</p>
                        </div>
                      </div>
                      <Switch checked={enableDenoise} onCheckedChange={setEnableDenoise} disabled={isRunning} />
                    </div>

                    {/* Step 2: EQ */}
                    <div className="p-3 rounded-lg border bg-card space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Badge className="bg-green-500 text-white w-6 h-6 flex items-center justify-center p-0 rounded-full">2</Badge>
                          <Filter className="w-5 h-5 text-green-500" />
                          <div>
                            <p className="font-medium text-sm">EQ + פילטרים</p>
                            <p className="text-xs text-muted-foreground">High-Pass + Low-Pass + חיזוק דיבור</p>
                          </div>
                        </div>
                        <Switch checked={enableEQ} onCheckedChange={setEnableEQ} disabled={isRunning} />
                      </div>
                      {enableEQ && (
                        <div className="space-y-3 pr-12">
                          <div className="space-y-1">
                            <div className="flex justify-between text-xs">
                              <span>High-Pass (הסרת בס)</span>
                              <span className="font-mono">{hpFreq} Hz</span>
                            </div>
                            <Slider min={20} max={300} step={5} value={[hpFreq]} onValueChange={v => setHpFreq(v[0])} disabled={isRunning} />
                          </div>
                          <div className="space-y-1">
                            <div className="flex justify-between text-xs">
                              <span>Low-Pass (הסרת שריקות)</span>
                              <span className="font-mono">{lpFreq} Hz</span>
                            </div>
                            <Slider min={4000} max={20000} step={500} value={[lpFreq]} onValueChange={v => setLpFreq(v[0])} disabled={isRunning} />
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <Switch checked={boostPresence} onCheckedChange={setBoostPresence} disabled={isRunning} />
                            <span>חיזוק בהירות קול (3KHz +3dB)</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Step 3: Normalize */}
                    <div className="p-3 rounded-lg border bg-card space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Badge className="bg-orange-500 text-white w-6 h-6 flex items-center justify-center p-0 rounded-full">3</Badge>
                          <Volume2 className="w-5 h-5 text-orange-500" />
                          <div>
                            <p className="font-medium text-sm">נורמליזציה</p>
                            <p className="text-xs text-muted-foreground">איזון עוצמת שמע אחידה</p>
                          </div>
                        </div>
                        <Switch checked={enableNormalize} onCheckedChange={setEnableNormalize} disabled={isRunning} />
                      </div>
                      {enableNormalize && (
                        <div className="pr-12 space-y-1">
                          <div className="flex justify-between text-xs">
                            <span>עוצמת יעד</span>
                            <span className="font-mono">{targetDb} dBFS</span>
                          </div>
                          <Slider min={-30} max={-10} step={1} value={[targetDb]} onValueChange={v => setTargetDb(v[0])} disabled={isRunning} />
                        </div>
                      )}
                    </div>

                    {/* Step 4: AI Enhance */}
                    <div className="p-3 rounded-lg border bg-card space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Badge className="bg-purple-500 text-white w-6 h-6 flex items-center justify-center p-0 rounded-full">4</Badge>
                          <Brain className="w-5 h-5 text-purple-500" />
                          <div>
                            <p className="font-medium text-sm">שיפור AI (שרת)</p>
                            <p className="text-xs text-muted-foreground">Demucs / DeepFilter / MetricGAN</p>
                          </div>
                        </div>
                        <Switch checked={enableAI} onCheckedChange={setEnableAI} disabled={isRunning} />
                      </div>
                      {enableAI && (
                        <div className="pr-12 space-y-3">
                          <Select value={aiPreset} onValueChange={v => setAiPreset(v as EnhancementPreset)} disabled={isRunning}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {AI_PRESETS.map(p => (
                                <SelectItem key={p.id} value={p.id}>
                                  <div className="flex items-center gap-2">
                                    <p.icon className="w-4 h-4" />
                                    <span>{p.label}</span>
                                    <span className="text-xs text-muted-foreground">— {p.desc}</span>
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-2">
                            <span className="text-xs">פורמט פלט:</span>
                            <Select value={outputFormat} onValueChange={v => setOutputFormat(v as EnhancementOutputFormat)} disabled={isRunning}>
                              <SelectTrigger className="w-24 h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {OUTPUT_FORMATS.map(f => (
                                  <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          {!aiStatus?.available && (
                            <div className="flex items-center gap-2 text-xs text-yellow-600">
                              <AlertTriangle className="w-4 h-4" />
                              <span>שרת AI לא זמין — ודא שהשרת פעיל</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <Separator />

                    {/* Run button */}
                    <div className="flex gap-2">
                      {isRunning ? (
                        <Button variant="destructive" onClick={cancelPipeline} className="flex-1">
                          ביטול
                        </Button>
                      ) : (
                        <Button
                          onClick={runPipeline}
                          className="flex-1 gap-2 bg-purple-600 hover:bg-purple-700"
                          disabled={!file || (!enableDenoise && !enableEQ && !enableNormalize && !enableAI)}
                        >
                          {completedStages.size > 0 ? (
                            <><RotateCcw className="w-4 h-4" /> המשך מאיפה שנתקע</>
                          ) : (
                            <><Wand2 className="w-4 h-4" /> הפעל Pipeline</>
                          )}
                        </Button>
                      )}
                    </div>

                    {/* Progress */}
                    {isRunning && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>{stageLabel[pipelineStage]}</span>
                          <span className="mr-auto font-mono text-muted-foreground">{progress}%</span>
                        </div>
                        <Progress value={progress} className="h-2" />
                      </div>
                    )}

                    {error && (
                      <div className="flex items-center gap-2 text-sm text-red-500 p-2 bg-red-50 dark:bg-red-950/30 rounded">
                        <AlertTriangle className="w-4 h-4" />
                        <span>{error}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Right: Results + Player */}
                <div className="space-y-4">
                  {/* Results log */}
                  {stageResults.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-500" /> שלבים שהושלמו
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {stageResults.map((r, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs p-2 rounded bg-muted/50">
                            <Badge variant="outline" className="w-5 h-5 flex items-center justify-center p-0 rounded-full text-[10px]">
                              {i + 1}
                            </Badge>
                            <span className="flex-1">{r.label}</span>
                            <span className="font-mono text-muted-foreground">{(r.durationMs / 1000).toFixed(1)}s</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* A/B Player */}
                  {(originalUrl || cleanedUrl) && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">נגן השוואה</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* Track switcher */}
                        <div className="flex gap-1">
                          <Button
                            variant={activeTrack === "original" ? "default" : "outline"}
                            size="sm"
                            className="flex-1 text-xs"
                            onClick={() => switchTrack("original")}
                          >
                            מקור
                          </Button>
                          <Button
                            variant={activeTrack === "cleaned" ? "default" : "outline"}
                            size="sm"
                            className="flex-1 text-xs"
                            onClick={() => switchTrack("cleaned")}
                            disabled={!cleanedUrl}
                          >
                            מנוקה
                          </Button>
                        </div>

                        {/* Transport */}
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="icon" className="w-8 h-8" onClick={togglePlay} disabled={!originalUrl && !cleanedUrl}>
                            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                          </Button>
                          <span className="text-xs font-mono w-16 text-center">
                            {formatTime(currentTime)} / {formatTime(duration)}
                          </span>
                        </div>

                        {/* Seek bar */}
                        <Slider
                          min={0}
                          max={100}
                          step={0.1}
                          value={[duration > 0 ? (currentTime / duration) * 100 : 0]}
                          onValueChange={v => seek(v[0])}
                        />

                        {/* Download */}
                        {cleanedUrl && (
                          <Button variant="outline" size="sm" className="w-full gap-1" onClick={downloadCleaned}>
                            <Download className="w-4 h-4" /> הורד קובץ מנוקה
                          </Button>
                        )}

                        {/* Hidden audio elements */}
                        {originalUrl && (
                          <audio
                            ref={originalAudioRef}
                            src={originalUrl}
                            onEnded={() => setIsPlaying(false)}
                            preload="auto"
                          />
                        )}
                        {cleanedUrl && (
                          <audio
                            ref={cleanedAudioRef}
                            src={cleanedUrl}
                            onEnded={() => setIsPlaying(false)}
                            preload="auto"
                          />
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Pipeline flow visualization */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Layers className="w-4 h-4" /> זרימת Pipeline
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-col items-center gap-1 text-xs">
                        <PipelineNode label="קובץ מקור" icon={FileAudio} active={pipelineStage === "converting"} done={progress > 5} enabled />
                        {enableDenoise && (
                          <>
                            <ArrowDown className="w-3 h-3 text-muted-foreground" />
                            <PipelineNode label="RNNoise" icon={Shield} active={pipelineStage === "denoise"} done={progress > 35} enabled />
                          </>
                        )}
                        {enableEQ && (
                          <>
                            <ArrowDown className="w-3 h-3 text-muted-foreground" />
                            <PipelineNode label="EQ" icon={Filter} active={pipelineStage === "eq"} done={progress > 55} enabled />
                          </>
                        )}
                        {enableNormalize && (
                          <>
                            <ArrowDown className="w-3 h-3 text-muted-foreground" />
                            <PipelineNode label="Normalize" icon={Volume2} active={pipelineStage === "normalize"} done={progress > 70} enabled />
                          </>
                        )}
                        {enableAI && (
                          <>
                            <ArrowDown className="w-3 h-3 text-muted-foreground" />
                            <PipelineNode label="AI" icon={Brain} active={pipelineStage === "ai"} done={progress > 95} enabled />
                          </>
                        )}
                        <ArrowDown className="w-3 h-3 text-muted-foreground" />
                        <PipelineNode label="פלט נקי" icon={Sparkles} active={false} done={pipelineStage === "done"} enabled />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </>
          )}
        </TabsContent>

        {/* ═══ TAB 2: A/B Compare ═══ */}
        <TabsContent value="compare" className="mt-4">
          <QuickCompare aiStatus={aiStatus} />
        </TabsContent>

        {/* ═══ TAB 3: Info ═══ */}
        <TabsContent value="info" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Layers className="w-5 h-5" /> ארכיטקטורת Pipeline</CardTitle>
              <CardDescription>שלבי העיבוד ברצף — מהמקור לפלט נקי</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="space-y-3">
                <InfoStep num={1} color="blue" title="ניקוי רעש — RNNoise" desc="רשת נוירונים (WASM) שרצה בדפדפן. מסירה רעשי רקע קבועים: מזגן, מאוורר, זמזום חשמלי. מעבדת 480 דגימות בכל פריים ב-48KHz." tags={["CPU", "< 1MB", "מהיר"]} />
                <InfoStep num={2} color="green" title="EQ + פילטרים" desc="High-Pass מסיר רעשי בס מתחת ל-80Hz, Low-Pass מסיר ציפצופים מעל 12KHz. חיזוק אופציונלי ב-3KHz לבהירות דיבור ו-250Hz לחמימות." tags={["CPU", "Web Audio", "מהיר"]} />
                <InfoStep num={3} color="orange" title="נורמליזציה" desc="מאזן עוצמת שמע כך שחלקים שקטים וחזקים יהיו ברמה אחידה. ברירת מחדל: -20 dBFS." tags={["CPU", "מהיר"]} />
                <InfoStep num={4} color="purple" title="שיפור AI (שרת)" desc="Demucs להפרדת קולות ממוזיקה (~1GB), DeepFilterNet לשיפור בהירות קול (~100MB), MetricGAN-U לניקוי מתקדם. דורש שרת פעיל." tags={["GPU מומלץ", "2-30 שניות"]} />
              </div>

              <Separator />

              <div className="space-y-2">
                <h3 className="font-semibold">מתי להשתמש במה?</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div className="p-2 bg-blue-50 dark:bg-blue-950/30 rounded">
                    <p className="font-medium">🎤 רעש רקע קבוע</p>
                    <p className="text-muted-foreground">מזגן, מאוורר → שלב 1 (RNNoise)</p>
                  </div>
                  <div className="p-2 bg-green-50 dark:bg-green-950/30 rounded">
                    <p className="font-medium">📻 ציפצופים / זמזום</p>
                    <p className="text-muted-foreground">רעש חשמלי → שלב 2 (EQ)</p>
                  </div>
                  <div className="p-2 bg-orange-50 dark:bg-orange-950/30 rounded">
                    <p className="font-medium">🔊 ווליום לא אחיד</p>
                    <p className="text-muted-foreground">חלקים חלשים/חזקים → שלב 3</p>
                  </div>
                  <div className="p-2 bg-purple-50 dark:bg-purple-950/30 rounded">
                    <p className="font-medium">🎵 מוזיקה / קולות ברקע</p>
                    <p className="text-muted-foreground">רדיו, שיחות → שלב 4 (Demucs)</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <h3 className="font-semibold">תרחישים מומלצים</h3>
                <div className="flex flex-col gap-2 text-xs">
                  <div className="p-3 bg-muted/50 rounded flex items-center gap-3">
                    <Zap className="w-5 h-5 text-yellow-500 flex-shrink-0" />
                    <div>
                      <p className="font-medium">⚡ מהיר (90% מהמקרים)</p>
                      <p className="text-muted-foreground">RNNoise → EQ → Normalize — פחות משנייה, CPU בלבד</p>
                    </div>
                  </div>
                  <div className="p-3 bg-muted/50 rounded flex items-center gap-3">
                    <Brain className="w-5 h-5 text-purple-500 flex-shrink-0" />
                    <div>
                      <p className="font-medium">🤖 מלא (אודיו בעייתי)</p>
                      <p className="text-muted-foreground">RNNoise → EQ → Normalize → AI — 5-30 שניות, GPU מומלץ</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ─── sub-components ───────────────────────────────────────── */

function PipelineNode({ label, icon: Icon, active, done, enabled }: { label: string; icon: typeof FileAudio; active: boolean; done: boolean; enabled: boolean }) {
  return (
    <div className={`
      flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium transition-all
      ${active ? "border-purple-500 bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 ring-2 ring-purple-300 animate-pulse" : ""}
      ${done && !active ? "border-green-400 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300" : ""}
      ${!active && !done ? "border-muted text-muted-foreground" : ""}
    `}>
      {active ? <Loader2 className="w-3 h-3 animate-spin" /> : done ? <CheckCircle2 className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
      {label}
    </div>
  );
}

function InfoStep({ num, color, title, desc, tags }: { num: number; color: string; title: string; desc: string; tags: string[] }) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-500",
    green: "bg-green-500",
    orange: "bg-orange-500",
    purple: "bg-purple-500",
  };
  return (
    <div className="flex gap-3">
      <div className={`${colorMap[color] || "bg-gray-500"} text-white w-6 h-6 flex items-center justify-center rounded-full flex-shrink-0 text-xs font-bold`}>
        {num}
      </div>
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        <p className="text-muted-foreground text-xs">{desc}</p>
        <div className="flex gap-1 flex-wrap">
          {tags.map(t => (
            <Badge key={t} variant="secondary" className="text-[10px] h-4">{t}</Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Quick Compare (Tab 2) ────────────────────────────────── */

function QuickCompare({ aiStatus }: { aiStatus: AiEnhanceStatus | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [preset, setPreset] = useState<EnhancementPreset>("ai_hebrew");

  // Processing
  const [rnnoiseBlob, setRnnoiseBlob] = useState<Blob | null>(null);
  const [serverBlob, setServerBlob] = useState<Blob | null>(null);
  const [rnnoiseProcessing, setRnnoiseProcessing] = useState(false);
  const [serverProcessing, setServerProcessing] = useState(false);
  const [rnnoiseTime, setRnnoiseTime] = useState(0);
  const [serverTime, setServerTime] = useState(0);

  // Playback
  type CmpTrack = "original" | "rnnoise" | "server";
  const [activeTrack, setActiveTrack] = useState<CmpTrack>("original");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [rnnoiseUrl, setRnnoiseUrl] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  const audioOrigRef = useRef<HTMLAudioElement | null>(null);
  const audioRnRef = useRef<HTMLAudioElement | null>(null);
  const audioSrvRef = useRef<HTMLAudioElement | null>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (rnnoiseUrl) URL.revokeObjectURL(rnnoiseUrl);
      if (serverUrl) URL.revokeObjectURL(serverUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = useCallback((f: File) => {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (rnnoiseUrl) URL.revokeObjectURL(rnnoiseUrl);
    if (serverUrl) URL.revokeObjectURL(serverUrl);

    setFile(f);
    setOriginalUrl(URL.createObjectURL(f));
    setRnnoiseBlob(null);
    setServerBlob(null);
    setRnnoiseUrl(null);
    setServerUrl(null);
    setActiveTrack("original");
    setIsPlaying(false);

    // Start both processors
    setRnnoiseProcessing(true);
    setServerProcessing(true);

    const t0 = performance.now();
    processRnnoise(f).then(blob => {
      setRnnoiseTime(performance.now() - t0);
      setRnnoiseBlob(blob);
      setRnnoiseUrl(URL.createObjectURL(blob));
      setRnnoiseProcessing(false);
    }).catch(() => setRnnoiseProcessing(false));

    const t1 = performance.now();
    enhanceAudioOnServer(f, { preset, outputFormat: "mp3" }).then(res => {
      setServerTime(performance.now() - t1);
      setServerBlob(res.blob);
      setServerUrl(URL.createObjectURL(res.blob));
      setServerProcessing(false);
    }).catch(() => setServerProcessing(false));
  }, [originalUrl, rnnoiseUrl, serverUrl, preset]);

  const getAudioEl = useCallback((t: CmpTrack) => {
    if (t === "original") return audioOrigRef.current;
    if (t === "rnnoise") return audioRnRef.current;
    return audioSrvRef.current;
  }, []);

  const togglePlay = useCallback(() => {
    const a = getAudioEl(activeTrack);
    if (!a) return;
    if (isPlaying) { a.pause(); setIsPlaying(false); }
    else { a.play(); setIsPlaying(true); }
  }, [isPlaying, activeTrack, getAudioEl]);

  const switchTo = useCallback((track: CmpTrack) => {
    const cur = getAudioEl(activeTrack);
    const pos = cur?.currentTime || 0;
    const wasPaused = !isPlaying;
    if (cur) cur.pause();
    setActiveTrack(track);
    setIsPlaying(false);
    requestAnimationFrame(() => {
      const next = getAudioEl(track);
      if (next) {
        next.currentTime = pos;
        if (!wasPaused) { next.play(); setIsPlaying(true); }
      }
    });
  }, [activeTrack, isPlaying, getAudioEl]);

  useEffect(() => {
    const tick = () => {
      const a = getAudioEl(activeTrack);
      if (a) { setCurrentTime(a.currentTime); if (!isNaN(a.duration)) setDuration(a.duration); }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [activeTrack, getAudioEl]);

  const downloadTrack = useCallback((track: CmpTrack) => {
    const url = track === "rnnoise" ? rnnoiseUrl : serverUrl;
    if (!url || !file) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name.replace(/\.[^/.]+$/, "") + `.${track}.wav`;
    a.click();
  }, [rnnoiseUrl, serverUrl, file]);

  if (!file) {
    return (
      <Card
        className={`border-2 border-dashed transition-colors cursor-pointer ${dragActive ? "border-blue-500 bg-blue-500/5" : "border-muted-foreground/25 hover:border-blue-400"}`}
        onDragOver={e => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={e => { e.preventDefault(); setDragActive(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("audio/")) handleFile(f); }}
        onClick={() => fileInputRef.current?.click()}
      >
        <CardContent className="flex flex-col items-center justify-center py-12 gap-3">
          <AudioLines className="w-12 h-12 text-muted-foreground" />
          <p className="text-lg font-medium">גרור קובץ להשוואת A/B/C</p>
          <p className="text-sm text-muted-foreground">מקור vs RNNoise (דפדפן) vs AI (שרת)</p>
          <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="py-3 flex items-center gap-3 flex-wrap">
          <FileAudio className="w-5 h-5 text-blue-500" />
          <span className="font-medium">{file.name}</span>
          <Badge variant="outline">{formatBytes(file.size)}</Badge>
          <div className="flex-1" />
          <Select value={preset} onValueChange={v => setPreset(v as EnhancementPreset)}>
            <SelectTrigger className="w-48 h-8"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AI_PRESETS.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={() => { setFile(null); setOriginalUrl(null); setRnnoiseUrl(null); setServerUrl(null); }}>
            <RotateCcw className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>

      {/* Track selectors */}
      <div className="grid grid-cols-3 gap-2">
        <TrackCard
          label="מקור"
          icon={FileAudio}
          active={activeTrack === "original"}
          ready
          onClick={() => switchTo("original")}
        />
        <TrackCard
          label="RNNoise (דפדפן)"
          icon={Shield}
          active={activeTrack === "rnnoise"}
          ready={!!rnnoiseUrl}
          processing={rnnoiseProcessing}
          timeMs={rnnoiseTime}
          onClick={() => rnnoiseUrl && switchTo("rnnoise")}
          onDownload={() => downloadTrack("rnnoise")}
        />
        <TrackCard
          label="AI (שרת)"
          icon={Brain}
          active={activeTrack === "server"}
          ready={!!serverUrl}
          processing={serverProcessing}
          timeMs={serverTime}
          onClick={() => serverUrl && switchTo("server")}
          onDownload={() => downloadTrack("server")}
        />
      </div>

      {/* Player */}
      <Card>
        <CardContent className="py-3 space-y-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="w-10 h-10" onClick={togglePlay}>
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            </Button>
            <Slider
              min={0} max={100} step={0.1}
              value={[duration > 0 ? (currentTime / duration) * 100 : 0]}
              onValueChange={v => { const a = getAudioEl(activeTrack); if (a && !isNaN(a.duration)) a.currentTime = (v[0] / 100) * a.duration; }}
              className="flex-1"
            />
            <span className="text-xs font-mono w-20 text-center">{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Hidden audio */}
      {originalUrl && <audio ref={audioOrigRef} src={originalUrl} onEnded={() => setIsPlaying(false)} preload="auto" />}
      {rnnoiseUrl && <audio ref={audioRnRef} src={rnnoiseUrl} onEnded={() => setIsPlaying(false)} preload="auto" />}
      {serverUrl && <audio ref={audioSrvRef} src={serverUrl} onEnded={() => setIsPlaying(false)} preload="auto" />}
    </div>
  );
}

function TrackCard({ label, icon: Icon, active, ready, processing, timeMs, onClick, onDownload }: {
  label: string;
  icon: typeof FileAudio;
  active: boolean;
  ready: boolean;
  processing?: boolean;
  timeMs?: number;
  onClick: () => void;
  onDownload?: () => void;
}) {
  return (
    <Card
      className={`cursor-pointer transition-all ${active ? "ring-2 ring-purple-500 border-purple-400" : "hover:border-purple-300"} ${!ready && !processing ? "opacity-50" : ""}`}
      onClick={onClick}
    >
      <CardContent className="py-3 flex flex-col items-center gap-2">
        {processing ? (
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        ) : (
          <Icon className={`w-6 h-6 ${active ? "text-purple-500" : "text-muted-foreground"}`} />
        )}
        <span className="text-xs font-medium">{label}</span>
        {ready && timeMs !== undefined && timeMs > 0 && (
          <Badge variant="secondary" className="text-[10px]">{(timeMs / 1000).toFixed(1)}s</Badge>
        )}
        {ready && onDownload && (
          <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={e => { e.stopPropagation(); onDownload(); }}>
            <Download className="w-3 h-3" /> הורד
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
