import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Captions, Loader2 } from "lucide-react";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface VideoTranscriptViewerProps {
  videoUrl: string;
  /** transcript.json produced alongside the video. */
  transcriptJsonUrl?: string;
  srtUrl?: string;
  srtFilename?: string;
}

function fmtClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

/**
 * Plays the downloaded video with its transcript bound to it: the line being
 * spoken is highlighted and scrolled into view, and clicking any line seeks the
 * video there. The SRT is also offered as a real subtitle track, so the same
 * pairing survives outside the app.
 */
export function VideoTranscriptViewer({ videoUrl, transcriptJsonUrl, srtUrl, srtFilename }: VideoTranscriptViewerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (!transcriptJsonUrl) return;
    let cancelled = false;
    setLoading(true);
    fetch(transcriptJsonUrl)
      .then(r => r.json())
      .then((data) => {
        if (cancelled) return;
        const segs = (data.segments ?? [])
          .filter((s: TranscriptSegment) => s && Number.isFinite(s.start) && (s.text || '').trim())
          .map((s: TranscriptSegment) => ({ start: s.start, end: s.end, text: s.text.trim() }));
        setSegments(segs);
      })
      .catch(() => { /* transcript unavailable — video still plays */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [transcriptJsonUrl]);

  const activeIndex = segments.findIndex(s => currentTime >= s.start && currentTime < s.end);

  useEffect(() => {
    if (!follow || activeIndex < 0) return;
    activeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIndex, follow]);

  return (
    <Card className="p-4 space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Captions className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">וידאו עם תמלול מסונכרן</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={follow ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFollow(f => !f)}
            title="גלילה אוטומטית לשורה המושמעת"
          >
            {follow ? 'מעקב פעיל' : 'מעקב כבוי'}
          </Button>
          {srtUrl && (
            <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
              <a href={srtUrl} download={srtFilename || 'subtitles.srt'}>
                <Download className="w-3 h-3 ml-1" />SRT
              </a>
            </Button>
          )}
        </div>
      </div>

      <video
        ref={videoRef}
        src={videoUrl}
        controls
        className="w-full rounded-lg bg-black max-h-[45vh]"
        onTimeUpdate={(e) => setCurrentTime((e.target as HTMLVideoElement).currentTime)}
      >
        {srtUrl && <track kind="subtitles" srcLang="he" label="עברית" src={srtUrl} default />}
      </video>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />טוען תמלול...
        </div>
      )}

      {segments.length > 0 && (
        <div ref={listRef} className="max-h-[240px] overflow-y-auto rounded-lg border divide-y">
          {segments.map((seg, i) => {
            const active = i === activeIndex;
            return (
              <button
                key={i}
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = seg.start;
                    void videoRef.current.play();
                  }
                }}
                className={`w-full text-right px-3 py-2 text-sm transition-colors flex gap-3 ${
                  active ? 'bg-primary/10 font-medium' : 'hover:bg-muted/60'
                }`}
              >
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0 pt-0.5">
                  {fmtClock(seg.start)}
                </span>
                <span className="flex-1 leading-relaxed">{seg.text}</span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
