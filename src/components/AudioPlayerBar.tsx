import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Play, Pause, Rewind, FastForward, SkipBack, SkipForward, Volume2, VolumeX, Gauge,
} from "lucide-react";
import { registerPlayer, claimPlayback, releasePlayback } from "@/lib/activeAudio";

/**
 * נגן אודיו מלא וקומפקטי.
 *
 * עד עכשיו לשורת תוצאה הייתה רק לחצן נגן/עצור — אי אפשר היה לקפוץ
 * למקום, לשנות מהירות, או לדלג אחורה כדי לשמוע שוב משפט.
 *
 * שתי נקודות שלא מובנות מאליהן:
 *
 *  1. **רק נגן אחד מתנגן.** ברשימת קטעים יש נגן לכל קטע ועוד נגן צף.
 *     בלי תיאום אפשר להפעיל כמה יחד, והתוצאה בלגן. הרישום המשותף
 *     דואג שמי שמתחיל עוצר את כל השאר.
 *
 *  2. **כתובת הקובץ נוצרת כאן ומשוחררת כאן.** קובץ שנוצר בזיכרון
 *     נשאר תפוס עד שמשחררים אותו; ברשימה של עשרות קטעים זה מצטבר.
 */

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const JUMP_SEC = 10;

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

interface Props {
  file: File;
  /** שם להצגה. ריק פירושו בלי שורת שם. */
  title?: string;
  /** מעבר לקטע הקודם/הבא, כשיש כאלה. */
  onPrevious?: () => void;
  onNext?: () => void;
  /** ניגון אוטומטי של הקטע הבא כשזה נגמר. */
  onEnded?: () => void;
  autoPlay?: boolean;
  compact?: boolean;
  className?: string;
  testId?: string;
}

export function AudioPlayerBar({
  file, title, onPrevious, onNext, onEnded, autoPlay = false,
  compact = false, className = "", testId = "audio-player",
}: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playerId = useId();
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [seeking, setSeeking] = useState(false);

  useEffect(() => {
    const created = URL.createObjectURL(file);
    setUrl(created);
    setCurrent(0);
    setDuration(0);
    return () => URL.revokeObjectURL(created);
  }, [file]);

  // מי שמתחיל לנגן עוצר את כל השאר
  useEffect(() => registerPlayer(playerId, () => {
    audioRef.current?.pause();
  }), [playerId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed, url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = muted ? 0 : volume;
  }, [volume, muted, url]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      claimPlayback(playerId);
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [playerId]);

  const jump = useCallback((deltaSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + deltaSec));
  }, []);

  const seekTo = useCallback((value: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = value;
    setCurrent(value);
  }, []);

  if (!url) return null;

  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const btn = compact ? "h-7 w-7" : "h-8 w-8";

  return (
    <div
      className={`flex flex-col gap-1.5 ${className}`}
      dir="rtl"
      data-testid={testId}
      data-playing={playing ? "true" : "false"}
    >
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => { claimPlayback(playerId); setPlaying(true); }}
        onPause={() => { setPlaying(false); releasePlayback(playerId); }}
        onEnded={() => { setPlaying(false); releasePlayback(playerId); onEnded?.(); }}
        onLoadedMetadata={(e) => {
          const value = e.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
          if (autoPlay) { claimPlayback(playerId); void e.currentTarget.play().catch(() => undefined); }
        }}
        onTimeUpdate={(e) => { if (!seeking) setCurrent(e.currentTarget.currentTime); }}
        className="hidden"
      />

      {title && (
        <div className="truncate text-xs font-medium" title={title}>{title}</div>
      )}

      {/* פס ההתקדמות — לחיצה עליו קופצת למקום */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground" data-testid={`${testId}-current`}>
          {formatClock(current)}
        </span>
        <Slider
          value={[Math.min(current, duration || 0)]}
          max={duration || 0.001}
          step={0.1}
          onPointerDown={() => setSeeking(true)}
          onValueChange={(v) => setCurrent(v[0])}
          onValueCommit={(v) => { setSeeking(false); seekTo(v[0]); }}
          className="flex-1"
          aria-label="מיקום בקטע"
          data-testid={`${testId}-seek`}
        />
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground" data-testid={`${testId}-duration`}>
          {formatClock(duration)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-0.5">
        {onPrevious && (
          <Button size="icon" variant="ghost" className={btn} title="הקטע הקודם"
                  aria-label="הקטע הקודם" data-testid={`${testId}-prev`} onClick={onPrevious}>
            <SkipForward className={iconSize} />
          </Button>
        )}
        <Button size="icon" variant="ghost" className={btn} title={`אחורה ${JUMP_SEC} שניות`}
                aria-label={`אחורה ${JUMP_SEC} שניות`} data-testid={`${testId}-back`}
                onClick={() => jump(-JUMP_SEC)}>
          <Rewind className={iconSize} />
        </Button>
        <Button size="icon" variant="secondary" className={compact ? "h-8 w-8" : "h-9 w-9"}
                title={playing ? "עצור" : "נגן"} aria-label={playing ? "עצור" : "נגן"}
                data-testid={`${testId}-toggle`} onClick={toggle}>
          {playing ? <Pause className={iconSize} /> : <Play className={iconSize} />}
        </Button>
        <Button size="icon" variant="ghost" className={btn} title={`קדימה ${JUMP_SEC} שניות`}
                aria-label={`קדימה ${JUMP_SEC} שניות`} data-testid={`${testId}-forward`}
                onClick={() => jump(JUMP_SEC)}>
          <FastForward className={iconSize} />
        </Button>
        {onNext && (
          <Button size="icon" variant="ghost" className={btn} title="הקטע הבא"
                  aria-label="הקטע הבא" data-testid={`${testId}-next`} onClick={onNext}>
            <SkipBack className={iconSize} />
          </Button>
        )}

        <div className="mx-1 h-5 w-px bg-border" />

        {/* מהירות */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px] tabular-nums"
                    title="מהירות הניגון" data-testid={`${testId}-speed`}>
              <Gauge className="h-3.5 w-3.5" />
              {speed}×
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[7rem]">
            {SPEEDS.map((value) => (
              <DropdownMenuItem key={value} onClick={() => setSpeed(value)} className="text-xs tabular-nums">
                {value}× {value === 1 ? "(רגיל)" : ""}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* עוצמה */}
        <Button size="icon" variant="ghost" className={btn}
                title={muted ? "בטל השתקה" : "השתק"} aria-label={muted ? "בטל השתקה" : "השתק"}
                data-testid={`${testId}-mute`} onClick={() => setMuted((v) => !v)}>
          {muted || volume === 0 ? <VolumeX className={iconSize} /> : <Volume2 className={iconSize} />}
        </Button>
        <Slider
          value={[muted ? 0 : volume]}
          max={1}
          step={0.05}
          onValueChange={(v) => { setVolume(v[0]); if (v[0] > 0) setMuted(false); }}
          className="w-16"
          aria-label="עוצמת השמע"
          data-testid={`${testId}-volume`}
        />
      </div>
    </div>
  );
}

export default AudioPlayerBar;
