import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { Users, Upload, Loader2, Globe, Cloud, Copy, Download, Play, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { diarizeInBrowser, type DiarizationProgress } from "@/utils/browserDiarization";
import { useCloudApiKeys } from "@/hooks/useCloudApiKeys";

interface DiarizedSegment {
  text: string;
  start: number;
  end: number;
  speaker: string;
  speaker_label: string;
}

interface DiarizationResult {
  text: string;
  segments: DiarizedSegment[];
  speakers: string[];
  speaker_count: number;
  duration: number;
  processing_time: number;
  diarization_method: string;
}

const SPEAKER_COLORS = [
  "bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700",
  "bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700",
  "bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700",
  "bg-orange-100 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700",
  "bg-pink-100 dark:bg-pink-900/30 border-pink-300 dark:border-pink-700",
];

const SPEAKER_BADGE_COLORS = [
  "bg-blue-500", "bg-green-500", "bg-purple-500", "bg-orange-500", "bg-pink-500",
];

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(sec: number) {
  if (sec < 60) return `${Math.round(sec)} שנ׳`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${m} דק׳ ${s} שנ׳` : `${m} דק׳`;
}

function mergeConsecutive(segments: DiarizedSegment[]): DiarizedSegment[] {
  if (!segments.length) return [];
  const merged: DiarizedSegment[] = [{ ...segments[0] }];
  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = segments[i];
    if (curr.speaker_label === prev.speaker_label) {
      prev.text = prev.text + " " + curr.text;
      prev.end = curr.end;
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

interface InlineDiarizationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  audioFilePath?: string | null;
  transcriptText?: string;
  existingAudioUrl?: string | null;
}

export const InlineDiarization = ({ open, onOpenChange, audioFilePath, transcriptText, existingAudioUrl }: InlineDiarizationProps) => {
  const [result, setResult] = useState<DiarizationResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<DiarizationProgress | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { keys: cloudKeys } = useCloudApiKeys();
  const autoStartedRef = useRef(false);

  // Auto-start diarization when opened with an existing audio URL
  const startFromUrl = useCallback(async (url: string) => {
    setIsProcessing(true);
    setResult(null);
    setProgress(null);
    setAudioUrl(url);
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const file = new File([blob], "audio.wav", { type: blob.type || "audio/wav" });
      const data = await diarizeInBrowser(file, (p) => setProgress(p));
      const res: DiarizationResult = {
        text: data.segments.map(s => s.text).join(" "),
        ...data,
      };
      setResult(res);
      setProgress(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await (supabase as any).from('diarization_results').insert({
          user_id: user.id,
          file_name: "audio",
          segments: res.segments,
          speakers: res.speakers,
          speaker_names: {},
          speaker_count: res.speaker_count,
          duration: res.duration,
          processing_time: res.processing_time,
          diarization_method: res.diarization_method,
          engine: 'browser',
        });
      }
      toast({ title: "זיהוי דוברים הושלם", description: `${res.speaker_count} דוברים זוהו — נשמר אוטומטית` });
    } catch (err: unknown) {
      toast({ title: "שגיאה", description: err instanceof Error ? err.message : "Unknown", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  }, []);

  // When dialog opens with existingAudioUrl, auto-start
  useState(() => {
    // Using a ref to track if we already auto-started
  });

  // Effect to auto-start when opened
  const prevOpenRef = useRef(false);
  if (open && !prevOpenRef.current && existingAudioUrl && !result && !isProcessing) {
    prevOpenRef.current = true;
    setTimeout(() => startFromUrl(existingAudioUrl), 100);
  }
  if (!open && prevOpenRef.current) {
    prevOpenRef.current = false;
  }

  const speakerIndex = result ? Object.fromEntries(result.speakers.map((s, i) => [s, i])) : {};

  const handleFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setResult(null);
    setProgress(null);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);

    try {
      const data = await diarizeInBrowser(file, (p) => setProgress(p));
      const res: DiarizationResult = {
        text: data.segments.map(s => s.text).join(" "),
        ...data,
      };
      setResult(res);
      setProgress(null);

      // Save to diarization_results
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await (supabase as any).from('diarization_results').insert({
          user_id: user.id,
          file_name: file.name,
          segments: res.segments,
          speakers: res.speakers,
          speaker_names: {},
          speaker_count: res.speaker_count,
          duration: res.duration,
          processing_time: res.processing_time,
          diarization_method: res.diarization_method,
          engine: 'browser',
        });
      }

      toast({ title: "זיהוי דוברים הושלם", description: `${res.speaker_count} דוברים זוהו — נשמר אוטומטית` });
    } catch (err: unknown) {
      toast({ title: "שגיאה", description: err instanceof Error ? err.message : "Unknown", variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const playSegment = useCallback((idx: number, start: number, end: number) => {
    if (!audioUrl) return;
    if (playingIdx === idx && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
      setPlayingIdx(null);
      return;
    }
    if (!audioRef.current) audioRef.current = new Audio(audioUrl);
    else if (audioRef.current.src !== audioUrl) audioRef.current.src = audioUrl;
    const audio = audioRef.current;
    audio.currentTime = start;
    setPlayingIdx(idx);
    const onTime = () => {
      if (audio.currentTime >= end) { audio.pause(); setPlayingIdx(null); audio.removeEventListener('timeupdate', onTime); }
    };
    audio.onended = () => setPlayingIdx(null);
    audio.addEventListener('timeupdate', onTime);
    audio.play().catch(() => setPlayingIdx(null));
  }, [audioUrl, playingIdx]);

  const copyText = () => {
    if (!result) return;
    const segs = mergeConsecutive(result.segments);
    const text = segs.map(s => `[${s.speaker_label}] (${formatTime(s.start)}) ${s.text}`).join("\n");
    navigator.clipboard.writeText(text);
    toast({ title: "הועתק ללוח" });
  };

  const segments = result ? mergeConsecutive(result.segments) : [];

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { if (audioRef.current) audioRef.current.pause(); setResult(null); setProgress(null); setIsProcessing(false); prevOpenRef.current = false; } onOpenChange(v); }}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            זיהוי דוברים
          </DialogTitle>
        </DialogHeader>

        {/* Upload area - only show if no existing audio */}
        {!result && !isProcessing && !existingAudioUrl && (
          <>
            <input ref={fileInputRef} type="file" accept="audio/*,video/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />
            <div
              className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-all"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">לחץ לבחירת קובץ אודיו</p>
              <p className="text-xs text-muted-foreground mt-1">MP3, WAV, M4A, MP4 ועוד</p>
            </div>
            <p className="text-xs text-muted-foreground text-center flex items-center justify-center gap-1">
              <Globe className="w-3.5 h-3.5" />
              זיהוי בדפדפן — חינם, אופליין, ללא API
            </p>
          </>
        )}

        {/* Processing */}
        {isProcessing && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="text-sm font-medium">{progress?.stage || "מעבד..."}</span>
            {progress && <Progress value={progress.percent} className="w-full max-w-xs h-2" />}
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{result.speaker_count} דוברים</span>
                <span className="mx-1">·</span>
                <span>{formatDuration(result.duration)}</span>
                <span className="mx-1">·</span>
                <span>{result.processing_time}s</span>
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" className="text-xs" onClick={copyText}>
                  <Copy className="w-3.5 h-3.5 ml-1" />
                  העתק
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                  const blob = new Blob(["\uFEFF" + segments.map(s => `[${s.speaker_label}] (${formatTime(s.start)}-${formatTime(s.end)})\n${s.text}`).join("\n\n")], { type: "text/plain;charset=utf-8" });
                  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `diarization-${Date.now()}.txt`; a.click();
                }}>
                  <Download className="w-3.5 h-3.5 ml-1" />
                  הורד
                </Button>
              </div>
            </div>

            {/* Speaker stats cards */}
            <div className="grid grid-cols-2 gap-2">
              {result.speakers.map((sp) => {
                const time = result.segments.filter(s => s.speaker_label === sp).reduce((sum, s) => sum + (s.end - s.start), 0);
                const pct = result.duration > 0 ? (time / result.duration) * 100 : 0;
                const idx = speakerIndex[sp] ?? 0;
                return (
                  <div key={sp} className="relative overflow-hidden rounded-xl border bg-card p-3">
                    {/* Background fill */}
                    <div
                      className={`absolute inset-0 opacity-15 ${SPEAKER_BADGE_COLORS[idx % SPEAKER_BADGE_COLORS.length]}`}
                      style={{ width: `${pct}%` }}
                    />
                    <div className="relative flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full shrink-0 ${SPEAKER_BADGE_COLORS[idx % SPEAKER_BADGE_COLORS.length]}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm truncate">{sp}</p>
                        <p className="text-xs text-muted-foreground">{formatDuration(time)}</p>
                      </div>
                      <span className="text-lg font-bold text-foreground/80">{Math.round(pct)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Distribution bar */}
            <div className="flex h-2.5 rounded-full overflow-hidden">
              {result.speakers.map((sp) => {
                const time = result.segments.filter(s => s.speaker_label === sp).reduce((sum, s) => sum + (s.end - s.start), 0);
                const pct = result.duration > 0 ? (time / result.duration) * 100 : 0;
                const idx = speakerIndex[sp] ?? 0;
                return (
                  <div key={sp} className={`h-full ${SPEAKER_BADGE_COLORS[idx % SPEAKER_BADGE_COLORS.length]}`}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                );
              })}
            </div>

            {/* Segments */}
            <div className="space-y-1 max-h-[350px] overflow-y-auto">
              {segments.map((seg, i) => {
                const colorIdx = speakerIndex[seg.speaker_label] ?? 0;
                return (
                  <div key={i} className={`p-2 rounded border text-sm ${SPEAKER_COLORS[colorIdx % SPEAKER_COLORS.length]}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {audioUrl && (
                        <button
                          onClick={() => playSegment(i, seg.start, seg.end)}
                          className={`w-6 h-6 flex items-center justify-center rounded-full transition-colors ${
                            playingIdx === i
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted hover:bg-primary/20 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {playingIdx === i ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        </button>
                      )}
                      <span className={`w-2 h-2 rounded-full ${SPEAKER_BADGE_COLORS[colorIdx % SPEAKER_BADGE_COLORS.length]}`} />
                      <span className="font-semibold text-xs">{seg.speaker_label}</span>
                      <span className="text-xs text-muted-foreground">{formatTime(seg.start)} – {formatTime(seg.end)}</span>
                    </div>
                    <p className="text-right leading-relaxed">{seg.text}</p>
                  </div>
                );
              })}
            </div>

            {/* Run again */}
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => { setResult(null); setAudioUrl(null); }}>
              הרץ שוב עם קובץ אחר
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
