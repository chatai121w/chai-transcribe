import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GripVertical, X, Music2, ListMusic } from "lucide-react";
import { ResizeHandles } from "@/components/ui/ResizeHandles";
import { useFloatingPanel } from "@/hooks/useFloatingPanel";
import { AudioPlayerBar } from "@/components/AudioPlayerBar";
import { stopAll } from "@/lib/activeAudio";

/**
 * נגן צף לקטעי החיתוך.
 *
 * הצורך: אחרי חיתוך לשמונה קטעים רוצים לשמוע את כולם ברצף, בלי
 * לגלול כל פעם חזרה לשורה אחרת. הנגן הצף נשאר על המסך, אפשר לגרור
 * אותו לכל מקום, ולעבור בין הקטעים בלחיצה.
 *
 * הוא אינו רכיב חדש מאפס: הוא יושב על אותה חלונית צפה שכבר משמשת
 * את מרכז המשימות ואת הקונסול, ועל אותו נגן שבשורות התוצאה.
 */

export interface PlayableTrack {
  id: string;
  file: File;
  label: string;
}

interface Props {
  tracks: PlayableTrack[];
  /** הקטע שממנו להתחיל. */
  startId?: string | null;
  onClose: () => void;
}

export function FloatingCutPlayer({ tracks, startId, onClose }: Props) {
  const startIndex = useMemo(() => {
    const found = tracks.findIndex((track) => track.id === startId);
    return found >= 0 ? found : 0;
  }, [tracks, startId]);

  const [index, setIndex] = useState(startIndex);
  /*
    ניגון אוטומטי נדלק רק אחרי מעבר יזום לקטע אחר. בפתיחה הראשונה
    הוא כבוי, כדי שהנגן לא יתחיל להשמיע בלי שביקשו.
  */
  const [auto, setAuto] = useState(false);

  useEffect(() => { setIndex(startIndex); }, [startIndex]);

  // הנגן הצף נסגר — אין טעם שמשהו יישאר מתנגן ברקע
  useEffect(() => () => stopAll(), []);

  const panel = useFloatingPanel({
    storageKey: "cutPlayer.panel",
    defaultSize: { width: 430, height: 230 },
    minSize: { width: 320, height: 190 },
    maxSize: { width: 900, height: 420 },
    defaultPos: (size) => ({
      left: 16,
      top: typeof window === "undefined" ? 120 : Math.max(16, window.innerHeight - size.height - 90),
    }),
  });

  const goto = useCallback((next: number) => {
    if (next < 0 || next >= tracks.length) return;
    setAuto(true);
    setIndex(next);
  }, [tracks.length]);

  const track = tracks[index];
  if (!track) return null;

  return (
    <div
      dir="rtl"
      data-testid="floating-cut-player"
      style={{
        left: panel.pos.left, top: panel.pos.top,
        width: panel.size.width, height: panel.size.height,
      }}
      className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
    >
      <ResizeHandles onStart={panel.startResize} />

      {/* הכותרת היא גם ידית הגרירה */}
      <div
        onPointerDown={panel.startMove}
        data-testid="cut-player-drag"
        className="flex shrink-0 cursor-grab items-center gap-2 border-b px-3 py-2 active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
        <Music2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <h3 className="truncate text-sm font-semibold">נגן הקטעים</h3>
        <Badge variant="secondary" className="shrink-0 text-[10px] tabular-nums">
          {index + 1} מתוך {tracks.length}
        </Badge>
        <Button
          variant="ghost" size="icon" className="mr-auto h-7 w-7"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
          title="סגור" aria-label="סגור את נגן הקטעים"
          data-testid="cut-player-close"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <AudioPlayerBar
          key={track.id}
          file={track.file}
          title={track.label}
          autoPlay={auto}
          testId="cut-player"
          onPrevious={index > 0 ? () => goto(index - 1) : undefined}
          onNext={index < tracks.length - 1 ? () => goto(index + 1) : undefined}
          // בסוף קטע ממשיכים לבא, כדי שאפשר יהיה לשמוע הכול ברצף
          onEnded={index < tracks.length - 1 ? () => goto(index + 1) : undefined}
        />

        {tracks.length > 1 && (
          <div className="mt-3 border-t pt-2">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ListMusic className="h-3.5 w-3.5" />
              <span>כל הקטעים</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {tracks.map((item, position) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={position === index ? "secondary" : "ghost"}
                  className="h-7 max-w-[13rem] justify-start gap-1 text-[11px]"
                  data-testid="cut-player-track"
                  data-current={position === index ? "true" : "false"}
                  onClick={() => goto(position)}
                >
                  <span className="shrink-0 tabular-nums text-muted-foreground">{position + 1}.</span>
                  <span className="truncate">{item.label}</span>
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default FloatingCutPlayer;
