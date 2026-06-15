import { useEffect, useRef, useState } from "react";
import { Play, Pause, Download, Volume2, VolumeX, Gauge, X, SkipBack } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

interface Props {
  blob: Blob | null;
  fileName?: string;
  onClose?: () => void;
  onDownload?: () => void;
  /** When true, render inline instead of fixed floating. */
  inline?: boolean;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const fmt = (s: number) => {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
};

export function HarmonyPlayer({ blob, fileName, onClose, onDownload, inline }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!blob || !containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "hsl(var(--muted-foreground) / 0.3)",
      progressColor: "hsl(var(--primary))",
      cursorColor: "hsl(var(--foreground))",
      cursorWidth: 1,
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      height: 48,
      normalize: true,
    });

    ws.loadBlob(blob);
    ws.on("ready", () => {
      setDuration(ws.getDuration());
      ws.setVolume(volume);
      ws.setPlaybackRate(speed, true);
    });
    ws.on("audioprocess", () => setCurrent(ws.getCurrentTime()));
    ws.on("seeking", () => setCurrent(ws.getCurrentTime()));
    ws.on("finish", () => setPlaying(false));

    wsRef.current = ws;
    return () => {
      ws.destroy();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob]);

  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (playing) void ws.play();
    else ws.pause();
  }, [playing]);

  useEffect(() => {
    wsRef.current?.setVolume(muted ? 0 : volume);
  }, [volume, muted]);

  useEffect(() => {
    wsRef.current?.setPlaybackRate(speed, true);
  }, [speed]);

  if (!blob) return null;

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(speed);
    setSpeed(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  return (
    <div
      dir="rtl"
      className={inline
        ? "rounded-2xl border border-border bg-card p-3 shadow-sm"
        : "fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur-xl md:inset-x-6 md:bottom-6"
      }
    >
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          onClick={() => setPlaying((p) => !p)}
          className="h-11 w-11 shrink-0 rounded-full"
          aria-label={playing ? "עצור" : "נגן"}
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
        </Button>

        <button
          onClick={() => {
            wsRef.current?.seekTo(0);
            setCurrent(0);
          }}
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:flex"
          aria-label="חזור להתחלה"
        >
          <SkipBack className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="truncate font-medium text-foreground">{fileName ?? "מיקס מהורמן"}</span>
            <span className="shrink-0 tabular-nums" dir="ltr">
              {fmt(current)} / {fmt(duration)}
            </span>
          </div>
          <div ref={containerRef} className="mt-1" />
        </div>

        <button
          onClick={cycleSpeed}
          className="hidden h-9 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:inline-flex"
          aria-label="מהירות"
        >
          <Gauge className="h-3.5 w-3.5" />
          <span className="tabular-nums" dir="ltr">{speed}x</span>
        </button>

        <div className="hidden items-center gap-2 md:flex">
          <button
            onClick={() => setMuted((m) => !m)}
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={muted ? "בטל השתקה" : "השתק"}
          >
            {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <Slider
            className="w-20"
            min={0}
            max={100}
            step={1}
            value={[muted ? 0 : Math.round(volume * 100)]}
            onValueChange={([val]) => {
              setMuted(false);
              setVolume(val / 100);
            }}
          />
        </div>

        {onDownload && (
          <Button size="sm" variant="secondary" onClick={onDownload} className="hidden gap-1.5 sm:inline-flex">
            <Download className="h-3.5 w-3.5" />
            WAV
          </Button>
        )}

        {onClose && (
          <button
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="סגור נגן"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
