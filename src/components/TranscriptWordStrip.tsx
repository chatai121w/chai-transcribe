/**
 * רצועת המילים של החיתוך.
 *
 * מציגה את התמלול מילה-מילה מעל גלי הקול:
 *   • לחיצה על מילה — הנגן קופץ לאותה שנייה.
 *   • גרירה על כמה מילים, או לחיצה עם Shift — מסמנת קטע.
 *   • לחיצה כפולה — מסמנת משפט שלם.
 *   • "סמן לחיתוך" הופך את הסימון לאזור חיתוך אמיתי.
 *
 * הרכיב עצמו אינו חותך ואינו מזיז זמנים. הוא רק מדווח למעלה איזה
 * טווח סומן, וההחלטה מה לעשות בו — כולל ההצמדה לשקט — נשארת
 * בעורך החיתוך.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Scissors, X, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { findActiveWordIndex } from "@/lib/whisperAlignment";
import { detectSentences, sentenceAtIndex, wordsToRange, type CutWord } from "@/lib/transcriptCut";
import type { AudioRange } from "@/lib/audioEditPlan";

export interface TranscriptWordStripProps {
  words: CutWord[];
  /** הזמן שהנגן נמצא בו עכשיו, כדי להאיר את המילה הנאמרת. */
  currentTime: number;
  durationSec: number;
  /** אזורי חיתוך שכבר מסומנים — המילים שבתוכם מסומנות גם ברצועה. */
  markedRanges?: AudioRange[];
  onSeek: (sec: number) => void;
  onMarkRange: (range: AudioRange) => void;
  onPreviewRange?: (range: AudioRange) => void;
  /** נדלק כשהנגן מתנגן, כדי לגלול אל המילה הנאמרת. */
  following?: boolean;
  className?: string;
}

/** מילה שהמנוע לא היה בטוח בה — הטקסט אולי שגוי, אבל הזמן שלה בסדר. */
const LOW_CONFIDENCE = 0.5;

function formatSec(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00.0";
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

export default function TranscriptWordStrip({
  words,
  currentTime,
  durationSec,
  markedRanges = [],
  onSeek,
  onMarkRange,
  onPreviewRange,
  following = false,
  className,
}: TranscriptWordStripProps) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const [head, setHead] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const sentences = useMemo(() => detectSentences(words), [words]);

  const activeIndex = useMemo(
    () => findActiveWordIndex(words, currentTime, 0.04, true),
    [words, currentTime],
  );

  const selection = useMemo(() => {
    if (anchor === null || head === null) return null;
    return { from: Math.min(anchor, head), to: Math.max(anchor, head) };
  }, [anchor, head]);

  const selectedRange = useMemo(
    () => (selection ? wordsToRange(words, selection.from, selection.to, { durationSec }) : null),
    [selection, words, durationSec],
  );

  /** מילה שנמצאת בתוך אזור חיתוך שכבר סומן. */
  const isMarked = useCallback(
    (word: CutWord) => markedRanges.some(
      (range) => word.start >= range.startSec - 0.01 && word.end <= range.endSec + 0.01,
    ),
    [markedRanges],
  );

  // גלילה אל המילה הנאמרת, רק בזמן השמעה, וכמובן לא בזמן סימון.
  useEffect(() => {
    if (!following || dragging || activeIndex < 0) return;
    wordRefs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [following, dragging, activeIndex]);

  // שחרור העכבר בכל מקום בחלון מסיים את הגרירה, גם אם יצא מהרצועה.
  useEffect(() => {
    if (!dragging) return;
    const stop = () => setDragging(false);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [dragging]);

  const clearSelection = useCallback(() => {
    setAnchor(null);
    setHead(null);
  }, []);

  const handlePointerDown = useCallback(
    (index: number, event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      if (event.shiftKey && anchor !== null) {
        setHead(index);
        return;
      }
      setAnchor(index);
      setHead(index);
      setDragging(true);
      const word = words[index];
      if (word) onSeek(word.start);
    },
    [anchor, words, onSeek],
  );

  const handlePointerEnter = useCallback(
    (index: number) => {
      if (dragging) setHead(index);
    },
    [dragging],
  );

  const handleDoubleClick = useCallback(
    (index: number) => {
      const sentence = sentenceAtIndex(sentences, index);
      if (!sentence) return;
      setAnchor(sentence.startIndex);
      setHead(sentence.endIndex);
      setDragging(false);
    },
    [sentences],
  );

  /** מקלדת: חצים מזיזים את קצה הסימון, רווח משמיע, Escape מבטל. */
  const handleKeyDown = useCallback(
    (index: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape") {
        clearSelection();
        return;
      }
      if (!event.shiftKey) return;
      // בעברית החץ שמאלה הוא קדימה בטקסט.
      const forward = event.key === "ArrowLeft";
      const backward = event.key === "ArrowRight";
      if (!forward && !backward) return;
      event.preventDefault();
      const base = head ?? index;
      const next = Math.max(0, Math.min(words.length - 1, base + (forward ? 1 : -1)));
      if (anchor === null) setAnchor(index);
      setHead(next);
    },
    [anchor, head, words.length, clearSelection],
  );

  const markSelection = useCallback(() => {
    if (!selectedRange) return;
    onMarkRange(selectedRange);
    clearSelection();
  }, [selectedRange, onMarkRange, clearSelection]);

  if (!words.length) return null;

  return (
    <div className={cn("space-y-2", className)} data-testid="transcript-word-strip">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <MousePointerClick className="h-3.5 w-3.5" />
        <span>לחיצה על מילה — קפיצה בנגן. גרירה או Shift — סימון קטע. לחיצה כפולה — משפט שלם.</span>
        <Badge variant="outline" className="font-mono tabular-nums">{words.length} מילים</Badge>
      </div>

      <div
        ref={containerRef}
        dir="rtl"
        className="max-h-56 overflow-y-auto rounded-md border bg-muted/30 p-3 leading-loose select-none"
        onPointerLeave={() => setDragging(false)}
      >
        {words.map((word, index) => {
          const inSelection = selection ? index >= selection.from && index <= selection.to : false;
          const marked = isMarked(word);
          const uncertain = word.probability != null && word.probability < LOW_CONFIDENCE;
          return (
            <button
              key={`${index}-${word.start}`}
              ref={(el) => { wordRefs.current[index] = el; }}
              type="button"
              data-word-index={index}
              data-selected={inSelection ? "true" : "false"}
              data-active={index === activeIndex ? "true" : "false"}
              data-marked={marked ? "true" : "false"}
              title={`${formatSec(word.start)} — ${formatSec(word.end)}`}
              onPointerDown={(event) => handlePointerDown(index, event)}
              onPointerEnter={() => handlePointerEnter(index)}
              onDoubleClick={() => handleDoubleClick(index)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              className={cn(
                "mx-0.5 my-0.5 rounded px-1 py-0.5 text-sm transition-colors",
                "hover:bg-primary/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
                marked && "bg-amber-200/60 dark:bg-amber-500/25",
                inSelection && "bg-primary/30",
                index === activeIndex && "ring-2 ring-amber-500 font-semibold",
                uncertain && "underline decoration-dotted decoration-destructive/70 underline-offset-2",
              )}
            >
              {word.word}
            </button>
          );
        })}
      </div>

      {selectedRange ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 p-2"
          data-testid="word-selection-bar"
        >
          <span className="font-mono text-xs tabular-nums">
            {formatSec(selectedRange.startSec)} ← {formatSec(selectedRange.endSec)}
          </span>
          <Badge variant="secondary" className="font-mono tabular-nums">
            {(selectedRange.endSec - selectedRange.startSec).toFixed(2)} שניות
          </Badge>
          <span className="max-w-[28rem] truncate text-xs text-muted-foreground" dir="rtl">
            {selectedRange.label}
          </span>
          <div className="ms-auto flex items-center gap-2">
            {onPreviewRange && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onPreviewRange(selectedRange)}
                data-testid="preview-selection"
              >
                <Play className="me-1 h-3.5 w-3.5" />
                השמע
              </Button>
            )}
            <Button type="button" size="sm" onClick={markSelection} data-testid="mark-selection">
              <Scissors className="me-1 h-3.5 w-3.5" />
              סמן לחיתוך
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={clearSelection}
              data-testid="clear-selection"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
