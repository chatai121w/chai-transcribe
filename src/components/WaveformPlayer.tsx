import { useEffect, useRef, useState, useImperativeHandle, forwardRef, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, SkipBack, Volume2, VolumeX } from "lucide-react";

export interface WaveformPlayerHandle {
  seekTo: (seconds: number) => void;
}

interface WordTiming {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

interface WaveformPlayerProps {
  audioSrc?: string | null;
  wordTimings?: WordTiming[];
  className?: string;
  onTimeUpdate?: (time: number) => void;
}

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

export const WaveformPlayer = forwardRef<WaveformPlayerHandle, WaveformPlayerProps>(
  ({ audioSrc, wordTimings = [], className = "", onTimeUpdate }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WaveSurfer | null>(null);
    const blobUrlRef = useRef<string | null>(null);
    const onTimeUpdateRef = useRef(onTimeUpdate);
    useEffect(() => { onTimeUpdateRef.current = onTimeUpdate; }, [onTimeUpdate]);

    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [ready, setReady] = useState(false);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => {
        const ws = wsRef.current;
        if (ws && duration > 0) {
          ws.seekTo(Math.max(0, Math.min(1, seconds / duration)));
        }
      },
    }));

    // Init wavesurfer once
    useEffect(() => {
      if (!containerRef.current) return;
      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: "hsl(215 20% 65%)",
        progressColor: "hsl(221 83% 53%)",
        cursorColor: "hsl(221 83% 53%)",
        height: 56,
        normalize: true,
        interact: true,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
      });
      wsRef.current = ws;

      ws.on("ready", () => {
        setDuration(ws.getDuration());
        setReady(true);
      });
      ws.on("timeupdate", (t: number) => { setCurrentTime(t); onTimeUpdateRef.current?.(t); });
      ws.on("play", () => setPlaying(true));
      ws.on("pause", () => setPlaying(false));
      ws.on("finish", () => { setPlaying(false); });

      return () => {
        ws.destroy();
        wsRef.current = null;
      };
    }, []);

    // Load new audio when src changes
    useEffect(() => {
      const ws = wsRef.current;
      if (!ws) return;
      setReady(false);
      setCurrentTime(0);
      setDuration(0);
      setPlaying(false);

      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }

      if (audioSrc) {
        ws.load(audioSrc);
      }
    }, [audioSrc]);

    // Volume / mute sync
    useEffect(() => {
      wsRef.current?.setVolume(muted ? 0 : volume);
    }, [volume, muted]);

    const togglePlay = useCallback(() => {
      wsRef.current?.playPause();
    }, []);

    const restart = useCallback(() => {
      wsRef.current?.seekTo(0);
    }, []);

    // Find active word at currentTime
    const activeWord = wordTimings.find(
      (w) => currentTime >= w.start && currentTime <= w.end
    );

    if (!audioSrc) return null;

    return (
      <div
        className={`rounded-xl border bg-card p-3 space-y-2 shadow-sm ${className}`}
        dir="ltr"
      >
        {/* Waveform canvas */}
        <div ref={containerRef} className="w-full rounded-md overflow-hidden" />

        {/* Controls row */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={restart}
            title="חזור להתחלה"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </Button>

          <Button
            size="icon"
            onClick={togglePlay}
            disabled={!ready}
            className="h-8 w-8"
            title={playing ? "השהה" : "נגן"}
          >
            {playing ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>

          <span className="text-xs text-muted-foreground font-mono tabular-nums whitespace-nowrap">
            {fmtTime(currentTime)} / {fmtTime(duration)}
          </span>

          {/* Active word bubble */}
          {activeWord && (
            <Badge
              variant="secondary"
              className="text-xs font-mono mr-auto px-2 py-0.5"
              dir="rtl"
            >
              ▶ {activeWord.word}
            </Badge>
          )}

          {/* Volume */}
          <div className="flex items-center gap-1.5 mr-auto">
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setMuted((m) => !m)}
              title={muted ? "בטל השתקה" : "השתק"}
            >
              {muted ? (
                <VolumeX className="h-3 w-3" />
              ) : (
                <Volume2 className="h-3 w-3" />
              )}
            </Button>
            <Slider
              className="w-20"
              min={0}
              max={1}
              step={0.05}
              value={[muted ? 0 : volume]}
              onValueChange={([v]) => {
                setVolume(v);
                if (v > 0) setMuted(false);
              }}
            />
          </div>
        </div>

        {/* Word timeline strip */}
        {wordTimings.length > 0 && duration > 0 && (
          <div
            className="relative h-5 w-full rounded bg-muted/40 overflow-hidden cursor-pointer"
            title="לחץ למיקום"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const fraction = (e.clientX - rect.left) / rect.width;
              wsRef.current?.seekTo(fraction);
            }}
          >
            {wordTimings.map((w, i) => {
              const left = (w.start / duration) * 100;
              const width = Math.max(0.3, ((w.end - w.start) / duration) * 100);
              const isActive =
                currentTime >= w.start && currentTime <= w.end;
              const p = w.probability ?? 1;
              const color =
                p >= 0.9
                  ? "bg-green-500/60"
                  : p >= 0.7
                  ? "bg-yellow-400/60"
                  : "bg-red-400/60";
              return (
                <div
                  key={i}
                  className={`absolute top-0.5 bottom-0.5 rounded-sm transition-opacity ${color} ${
                    isActive ? "opacity-100 ring-1 ring-primary" : "opacity-40"
                  }`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`${w.word} (${fmtTime(w.start)})`}
                />
              );
            })}
            {/* Playhead */}
            {duration > 0 && (
              <div
                className="absolute top-0 bottom-0 w-px bg-primary z-10"
                style={{ left: `${(currentTime / duration) * 100}%` }}
              />
            )}
          </div>
        )}
      </div>
    );
  }
);

WaveformPlayer.displayName = "WaveformPlayer";
