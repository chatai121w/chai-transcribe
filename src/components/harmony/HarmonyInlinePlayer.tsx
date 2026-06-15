import { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, SkipBack, Volume2, VolumeX } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

interface Props {
  file: File | null;
  label?: string;
}

const fmt = (s: number) => {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
};

export function HarmonyInlinePlayer({ file, label }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [ready, setReady] = useState(false);

  const destroy = useCallback(() => {
    wsRef.current?.destroy();
    wsRef.current = null;
    setPlaying(false);
    setDuration(0);
    setCurrent(0);
    setReady(false);
  }, []);

  useEffect(() => {
    destroy();
    if (!file || !containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "hsl(var(--muted-foreground) / 0.25)",
      progressColor: "hsl(var(--primary))",
      cursorColor: "hsl(var(--foreground))",
      cursorWidth: 1,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      height: 64,
      normalize: true,
    });

    ws.loadBlob(file);
    ws.on("ready", () => {
      setDuration(ws.getDuration());
      ws.setVolume(volume / 100);
      setReady(true);
    });
    ws.on("audioprocess", () => setCurrent(ws.getCurrentTime()));
    ws.on("seeking", () => setCurrent(ws.getCurrentTime()));
    ws.on("finish", () => setPlaying(false));

    wsRef.current = ws;
    return destroy;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (playing) void ws.play();
    else ws.pause();
  }, [playing]);

  useEffect(() => {
    wsRef.current?.setVolume(muted ? 0 : volume / 100);
  }, [volume, muted]);

  if (!file) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label ?? "ווקאל מקור"}</span>
        <span className="text-[11px] tabular-nums text-muted-foreground" dir="ltr">
          {fmt(current)} / {fmt(duration)}
        </span>
      </div>

      {/* Waveform */}
      <div ref={containerRef} className="rounded-lg bg-muted/30 p-2" />

      {/* Controls */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          className="h-9 w-9 rounded-full"
          disabled={!ready}
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "עצור" : "נגן"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
        </Button>

        <button
          onClick={() => {
            wsRef.current?.seekTo(0);
            setCurrent(0);
          }}
          disabled={!ready}
          className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          aria-label="חזור להתחלה"
        >
          <SkipBack className="h-3.5 w-3.5" />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setMuted((m) => !m)}
          className="text-muted-foreground transition-colors hover:text-foreground"
          aria-label={muted ? "בטל השתקה" : "השתק"}
        >
          {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <Slider
          className="w-24"
          min={0}
          max={100}
          step={1}
          value={[muted ? 0 : volume]}
          onValueChange={([v]) => {
            setMuted(false);
            setVolume(v);
          }}
        />
      </div>
    </div>
  );
}
