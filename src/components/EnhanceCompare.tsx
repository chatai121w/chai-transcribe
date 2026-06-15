/**
 * EnhanceCompare — A/B comparison between two enhancement engines:
 * A = RNNoise WASM (browser, real-time neural network)
 * B = Server AI (MetricGAN-U / ai_hebrew via /enhance-audio)
 *
 * User uploads a file, both engines process it, and they can listen to
 * Original / A / B side-by-side with instant switching.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import {
  Brain,
  Download,
  FileAudio,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  UploadCloud,
  Volume2,
  Zap,
} from "lucide-react";
import { Rnnoise, type DenoiseState as RnnoiseDenoiseState } from "@shiguredo/rnnoise-wasm";
import { enhanceAudioOnServer, type EnhancementPreset } from "@/lib/audioEnhancement";

type TrackId = "original" | "rnnoise" | "server";

interface ProcessedTrack {
  url: string;
  blob: Blob;
  label: string;
  durationMs: number;
}

const SERVER_PRESETS: { id: EnhancementPreset; label: string }[] = [
  { id: "ai_hebrew", label: "AI עברית (MetricGAN-U + EQ)" },
  { id: "ai_full", label: "AI שיפור מלא" },
  { id: "ai_enhance", label: "AI שיפור דיבור" },
  { id: "ai_denoise", label: "AI ניקוי רעש" },
  { id: "clean", label: "FFmpeg ניקוי קלאסי" },
  { id: "podcast", label: "FFmpeg פודקאסט" },
];

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

/**
 * Process audio through RNNoise WASM entirely in the browser.
 * Decodes → processes 480-sample frames → encodes to WAV blob.
 */
async function processWithRnnoise(file: File): Promise<Blob> {
  const rnnoise = await Rnnoise.load();
  const denoiseState = rnnoise.createDenoiseState();
  const FRAME_SIZE = rnnoise.frameSize; // 480

  // Decode audio to PCM
  const arrayBuf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const decoded = await ctx.decodeAudioData(arrayBuf);

  // Resample to 48kHz mono
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * 48000), 48000);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  const samples = rendered.getChannelData(0);

  // Process through RNNoise frame by frame
  const output = new Float32Array(samples.length);
  const frame = new Float32Array(FRAME_SIZE);

  for (let offset = 0; offset < samples.length; offset += FRAME_SIZE) {
    const remaining = samples.length - offset;
    const len = Math.min(FRAME_SIZE, remaining);

    // Fill frame (zero-pad if needed)
    frame.fill(0);
    for (let i = 0; i < len; i++) {
      frame[i] = samples[offset + i] * 32768.0; // Scale to 16-bit PCM
    }

    denoiseState.processFrame(frame);

    for (let i = 0; i < len; i++) {
      output[offset + i] = frame[i] / 32768.0;
    }
  }

  denoiseState.destroy();

  // Encode to WAV
  return encodeWav(output, 48000);
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const length = samples.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, 1, true);  // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);  // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, length * 2, true);

  // Convert float → 16-bit PCM
  for (let i = 0; i < length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export default function EnhanceCompare() {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [serverPreset, setServerPreset] = useState<EnhancementPreset>("ai_hebrew");

  // Processing state
  const [rnnoiseProcessing, setRnnoiseProcessing] = useState(false);
  const [serverProcessing, setServerProcessing] = useState(false);
  const [rnnoiseTrack, setRnnoiseTrack] = useState<ProcessedTrack | null>(null);
  const [serverTrack, setServerTrack] = useState<ProcessedTrack | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  // Playback
  const [activeTrack, setActiveTrack] = useState<TrackId>("original");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRefs = useRef<Record<TrackId, HTMLAudioElement | null>>({
    original: null,
    rnnoise: null,
    server: null,
  });
  const animFrameRef = useRef<number>(0);

  // Cleanup URLs on unmount
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (rnnoiseTrack?.url) URL.revokeObjectURL(rnnoiseTrack.url);
      if (serverTrack?.url) URL.revokeObjectURL(serverTrack.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = useCallback(() => {
    // Pause all
    Object.values(audioRefs.current).forEach(a => { if (a) { a.pause(); a.currentTime = 0; } });
    setIsPlaying(false);
    setCurrentTime(0);
    cancelAnimationFrame(animFrameRef.current);

    // Revoke URLs
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (rnnoiseTrack?.url) URL.revokeObjectURL(rnnoiseTrack.url);
    if (serverTrack?.url) URL.revokeObjectURL(serverTrack.url);

    setFile(null);
    setOriginalUrl(null);
    setRnnoiseTrack(null);
    setServerTrack(null);
    setActiveTrack("original");
    setDuration(0);
  }, [originalUrl, rnnoiseTrack, serverTrack]);

  const onFilePicked = useCallback((f: File) => {
    reset();
    setFile(f);
    const url = URL.createObjectURL(f);
    setOriginalUrl(url);
  }, [reset]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFilePicked(f);
  }, [onFilePicked]);

  // Start both engines
  const runComparison = useCallback(async () => {
    if (!file) return;

    // RNNoise (browser)
    setRnnoiseProcessing(true);
    const rnnoiseStart = performance.now();
    try {
      const blob = await processWithRnnoise(file);
      const url = URL.createObjectURL(blob);
      setRnnoiseTrack({
        url,
        blob,
        label: "RNNoise WASM (דפדפן)",
        durationMs: performance.now() - rnnoiseStart,
      });
    } catch (err) {
      toast({ title: "שגיאה ב-RNNoise", description: String(err), variant: "destructive" });
    } finally {
      setRnnoiseProcessing(false);
    }

    // Server AI
    setServerProcessing(true);
    const serverStart = performance.now();
    try {
      const result = await enhanceAudioOnServer(file, {
        preset: serverPreset,
        outputFormat: "mp3",
      });
      const url = URL.createObjectURL(result.blob);
      setServerTrack({
        url,
        blob: result.blob,
        label: SERVER_PRESETS.find(p => p.id === serverPreset)?.label || serverPreset,
        durationMs: performance.now() - serverStart,
      });
    } catch (err) {
      toast({ title: "שגיאה בשרת AI", description: String(err), variant: "destructive" });
    } finally {
      setServerProcessing(false);
    }
  }, [file, serverPreset]);

  // Playback sync — switch active track
  const switchTrack = useCallback((track: TrackId) => {
    const wasPlaying = isPlaying;
    const time = audioRefs.current[activeTrack]?.currentTime || currentTime;

    // Pause current
    Object.values(audioRefs.current).forEach(a => { if (a) a.pause(); });

    setActiveTrack(track);

    // Sync time & resume
    const el = audioRefs.current[track];
    if (el) {
      el.currentTime = time;
      if (wasPlaying) el.play().catch(() => {});
    }
  }, [activeTrack, isPlaying, currentTime]);

  const togglePlayPause = useCallback(() => {
    const el = audioRefs.current[activeTrack];
    if (!el) return;

    if (isPlaying) {
      el.pause();
      setIsPlaying(false);
      cancelAnimationFrame(animFrameRef.current);
    } else {
      el.play().catch(() => {});
      setIsPlaying(true);

      const tick = () => {
        const a = audioRefs.current[activeTrack];
        if (a) setCurrentTime(a.currentTime);
        animFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    }
  }, [activeTrack, isPlaying]);

  const seekTo = useCallback((pct: number) => {
    const time = (pct / 100) * duration;
    Object.entries(audioRefs.current).forEach(([, a]) => {
      if (a) a.currentTime = time;
    });
    setCurrentTime(time);
  }, [duration]);

  useEffect(() => {
    // When active track ends
    const el = audioRefs.current[activeTrack];
    if (!el) return;
    const onEnd = () => { setIsPlaying(false); cancelAnimationFrame(animFrameRef.current); };
    el.addEventListener("ended", onEnd);
    return () => el.removeEventListener("ended", onEnd);
  }, [activeTrack]);

  const downloadTrack = useCallback((track: ProcessedTrack, suffix: string) => {
    const a = document.createElement("a");
    a.href = track.url;
    const ext = track.blob.type.includes("wav") ? "wav" : "mp3";
    a.download = (file?.name.replace(/\.[^/.]+$/, "") || "audio") + `_${suffix}.${ext}`;
    a.click();
  }, [file]);

  const isProcessing = rnnoiseProcessing || serverProcessing;
  const hasResults = rnnoiseTrack || serverTrack;

  return (
    <Card className="border-2 border-primary/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          השוואת מנועי שיפור קול (A/B)
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          העלה קובץ → שני מנועים משפרים אותו → השווה ובחר את התוצאה הטובה יותר
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* File upload */}
        {!file ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={onDrop}
            className={`rounded-xl border-2 border-dashed p-6 text-center transition-all cursor-pointer ${
              dragActive ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
            }`}
            onClick={() => {
              const inp = document.createElement("input");
              inp.type = "file";
              inp.accept = "audio/*,video/*";
              inp.onchange = () => { if (inp.files?.[0]) onFilePicked(inp.files[0]); };
              inp.click();
            }}
          >
            <UploadCloud className="w-8 h-8 mx-auto mb-2 text-primary" />
            <p className="text-sm font-medium">גרור או בחר קובץ אודיו להשוואה</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* File info + controls */}
            <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileAudio className="w-4 h-4 text-primary shrink-0" />
                <span className="text-sm font-medium truncate">{file.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={reset}>
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Server preset selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">פריסט שרת:</span>
              <Select value={serverPreset} onValueChange={(v) => setServerPreset(v as EnhancementPreset)}>
                <SelectTrigger className="h-8 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVER_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Run button */}
            {!hasResults && !isProcessing && (
              <Button className="w-full gap-2" onClick={runComparison}>
                <Zap className="w-4 h-4" />
                הפעל השוואה
              </Button>
            )}

            {/* Processing indicators */}
            {isProcessing && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  {rnnoiseProcessing ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500" /> RNNoise (דפדפן) — מעבד...</>
                  ) : rnnoiseTrack ? (
                    <><Badge variant="secondary" className="text-[10px]">✓</Badge> RNNoise — {(rnnoiseTrack.durationMs / 1000).toFixed(1)}s</>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {serverProcessing ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" /> שרת AI ({SERVER_PRESETS.find(p => p.id === serverPreset)?.label}) — מעבד...</>
                  ) : serverTrack ? (
                    <><Badge variant="secondary" className="text-[10px]">✓</Badge> שרת — {(serverTrack.durationMs / 1000).toFixed(1)}s</>
                  ) : null}
                </div>
              </div>
            )}

            {/* Results — A/B player */}
            {hasResults && !isProcessing && (
              <div className="space-y-3">
                {/* Track selector buttons */}
                <div className="grid grid-cols-3 gap-2">
                  {/* Original */}
                  <button
                    onClick={() => switchTrack("original")}
                    className={`rounded-lg border-2 p-3 text-center transition-all ${
                      activeTrack === "original"
                        ? "border-primary bg-primary/10 shadow-sm"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    <Volume2 className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-xs font-semibold">מקור</p>
                    <p className="text-[10px] text-muted-foreground">ללא שינוי</p>
                  </button>

                  {/* RNNoise */}
                  <button
                    onClick={() => rnnoiseTrack && switchTrack("rnnoise")}
                    disabled={!rnnoiseTrack}
                    className={`rounded-lg border-2 p-3 text-center transition-all ${
                      activeTrack === "rnnoise"
                        ? "border-emerald-500 bg-emerald-500/10 shadow-sm"
                        : rnnoiseTrack ? "border-border hover:border-emerald-400" : "border-border opacity-50"
                    }`}
                  >
                    <Sparkles className="w-5 h-5 mx-auto mb-1 text-emerald-500" />
                    <p className="text-xs font-semibold">RNNoise</p>
                    <p className="text-[10px] text-muted-foreground">דפדפן • {rnnoiseTrack ? `${(rnnoiseTrack.durationMs / 1000).toFixed(1)}s` : "—"}</p>
                  </button>

                  {/* Server */}
                  <button
                    onClick={() => serverTrack && switchTrack("server")}
                    disabled={!serverTrack}
                    className={`rounded-lg border-2 p-3 text-center transition-all ${
                      activeTrack === "server"
                        ? "border-violet-500 bg-violet-500/10 shadow-sm"
                        : serverTrack ? "border-border hover:border-violet-400" : "border-border opacity-50"
                    }`}
                  >
                    <Brain className="w-5 h-5 mx-auto mb-1 text-violet-500" />
                    <p className="text-xs font-semibold">שרת AI</p>
                    <p className="text-[10px] text-muted-foreground">{serverTrack ? `${(serverTrack.durationMs / 1000).toFixed(1)}s` : "—"}</p>
                  </button>
                </div>

                {/* Playback controls */}
                <div className="flex items-center gap-3">
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-9 w-9 shrink-0"
                    onClick={togglePlayPause}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>

                  <div className="flex-1 space-y-1">
                    <Slider
                      value={[duration > 0 ? (currentTime / duration) * 100 : 0]}
                      min={0}
                      max={100}
                      step={0.1}
                      onValueChange={([v]) => seekTo(v)}
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>{formatTime(currentTime)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                  </div>
                </div>

                {/* Download buttons */}
                <div className="flex flex-wrap gap-2">
                  {rnnoiseTrack && (
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => downloadTrack(rnnoiseTrack, "rnnoise")}>
                      <Download className="w-3.5 h-3.5" /> RNNoise
                    </Button>
                  )}
                  {serverTrack && (
                    <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => downloadTrack(serverTrack, "server_ai")}>
                      <Download className="w-3.5 h-3.5" /> שרת AI
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 mr-auto" onClick={reset}>
                    <RotateCcw className="w-3.5 h-3.5" /> התחל מחדש
                  </Button>
                </div>

                {/* Stats */}
                <div className="rounded-lg border bg-muted/20 p-3 space-y-1 text-[11px]">
                  <p className="font-medium text-xs">סטטיסטיקות עיבוד</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground">
                    <span>קובץ מקור:</span><span className="font-mono">{formatBytes(file.size)}</span>
                    {rnnoiseTrack && <>
                      <span>RNNoise פלט:</span><span className="font-mono">{formatBytes(rnnoiseTrack.blob.size)} • {(rnnoiseTrack.durationMs / 1000).toFixed(1)}s</span>
                    </>}
                    {serverTrack && <>
                      <span>שרת AI פלט:</span><span className="font-mono">{formatBytes(serverTrack.blob.size)} • {(serverTrack.durationMs / 1000).toFixed(1)}s</span>
                    </>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Hidden audio elements */}
        {originalUrl && (
          <audio
            ref={(el) => { audioRefs.current.original = el; }}
            src={originalUrl}
            preload="auto"
            onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
          />
        )}
        {rnnoiseTrack && (
          <audio
            ref={(el) => { audioRefs.current.rnnoise = el; }}
            src={rnnoiseTrack.url}
            preload="auto"
          />
        )}
        {serverTrack && (
          <audio
            ref={(el) => { audioRefs.current.server = el; }}
            src={serverTrack.url}
            preload="auto"
          />
        )}
      </CardContent>
    </Card>
  );
}
