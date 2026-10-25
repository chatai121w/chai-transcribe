import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, GripVertical, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResizeHandles } from "@/components/ui/ResizeHandles";
import { useFloatingPanel } from "@/hooks/useFloatingPanel";
import { useJobs } from "@/hooks/useJobs";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import {
  readCloudJobsCenterVisible, readLocalJobsCenterVisible, writeLocalJobsCenterVisible,
} from "@/lib/jobsCenterPrefs";
import { JobCard } from "./JobCard";

const OPEN_KEY = "jobsCenter.open";
const BUTTON_KEY = "jobsCenter.button";

/** כמה זזה העכבר עד שזאת גרירה ולא לחיצה. */
const DRAG_SLOP = 4;

export function JobsCenter() {
  const { jobs, activeCount, loading } = useJobs();
  const { preferences, isLoaded } = useCloudPreferences();

  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(OPEN_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(OPEN_KEY, open ? "1" : "0"); } catch { /* noop */ }
  }, [open]);

  // ------------------------------------------------- האם להציג בכלל
  const [visible, setVisible] = useState<boolean>(() => readLocalJobsCenterVisible());
  useEffect(() => {
    if (!isLoaded) return;
    const cloud = readCloudJobsCenterVisible(preferences.tab_settings_json || "");
    if (cloud === null) return;
    setVisible(cloud);
    writeLocalJobsCenterVisible(cloud);
  }, [isLoaded, preferences.tab_settings_json]);

  // ------------------------------------------------- הכפתור הצף
  const btn = useFloatingPanel({
    storageKey: BUTTON_KEY,
    defaultSize: { width: 40, height: 40 },
    minSize: { width: 40, height: 40 },
    maxSize: { width: 40, height: 40 },
    defaultPos: () => ({
      left: 16,
      top: typeof window === "undefined" ? 600 : window.innerHeight - 56,
    }),
  });

  /**
   * הכפתור גם נגרר וגם נלחץ.
   *
   * בלי הבחנה ביניהם כל גרירה הייתה פותחת את הפאנל, וכל לחיצה
   * קטנה הייתה מזיזה אותו במעט. לכן נמדד כמה זזה העכבר: תזוזה
   * קטנה היא לחיצה, גדולה היא גרירה.
   */
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const onButtonDown = (e: React.PointerEvent) => {
    pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
    btn.startMove(e);
  };

  const onButtonMove = (e: React.PointerEvent) => {
    const p = pressRef.current;
    if (!p) return;
    if (Math.abs(e.clientX - p.x) > DRAG_SLOP || Math.abs(e.clientY - p.y) > DRAG_SLOP) {
      p.moved = true;
    }
  };

  const onButtonUp = () => {
    const p = pressRef.current;
    pressRef.current = null;
    if (p && !p.moved) setOpen((v) => !v);
  };

  // ------------------------------------------------- הפאנל
  const panel = useFloatingPanel({
    storageKey: "jobsCenter.panel",
    defaultSize: { width: 384, height: 460 },
    minSize: { width: 280, height: 220 },
    maxSize: { width: 720, height: 900 },
    defaultPos: (s) => ({
      left: 16,
      top: typeof window === "undefined" ? 100 : Math.max(16, window.innerHeight - s.height - 76),
    }),
  });

  const resetAll = useCallback(() => {
    panel.reset();
    btn.reset();
  }, [panel, btn]);

  if (!visible) return null;

  return (
    <>
      {/* הכפתור הצף — אפשר לגרור אותו לכל מקום */}
      <button
        type="button"
        onPointerDown={onButtonDown}
        onPointerMove={onButtonMove}
        onPointerUp={onButtonUp}
        aria-expanded={open}
        style={{ left: btn.pos.left, top: btn.pos.top }}
        className="fixed z-[60] flex h-10 w-10 cursor-grab items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-shadow hover:shadow-xl active:cursor-grabbing"
        title="מרכז המשימות · אפשר לגרור"
        aria-label="מרכז המשימות"
      >
        <Activity className="h-4 w-4 pointer-events-none" />
        {activeCount > 0 && (
          <Badge className="pointer-events-none absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[9px] tabular-nums">
            {activeCount}
          </Badge>
        )}
      </button>

      {open && (
        <div
          dir="rtl"
          style={{
            left: panel.pos.left, top: panel.pos.top,
            width: panel.size.width, height: panel.size.height,
          }}
          /*
            overflow-hidden הוא מה שמונע מהתוכן לקבוע את הרוחב.
            בלעדיו שם קובץ ארוך מתח את הפאנל הרבה מעבר למסגרת,
            וכל מה שבפנים נחתך בצד.
          */
          className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
        >
          <ResizeHandles onStart={panel.startResize} />

          {/* הכותרת היא גם ידית הגרירה */}
          <div
            onPointerDown={panel.startMove}
            className="flex shrink-0 cursor-grab items-center justify-between gap-2 border-b px-3 py-2 active:cursor-grabbing"
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
              <Activity className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <h3 className="truncate text-sm font-semibold">מרכז המשימות</h3>
              {activeCount > 0 && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {activeCount} פעילות
                </Badge>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost" size="sm" className="h-7 w-7 p-0"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={resetAll}
                title="החזר לגודל ולמקום המקוריים"
                aria-label="החזר לגודל ולמקום המקוריים"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost" size="sm" className="h-7 w-7 p-0"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setOpen(false)}
                aria-label="סגור"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/*
            גלילה פשוטה ולא רכיב הגלילה המעוצב: הרכיב ההוא מרנדר
            שכבה פנימית שמתרחבת לפי התוכן, וזה בדיוק מה שמתח את
            הפאנל 868 נקודות מעבר למסגרת.
          */}
          <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden">
            <div className="w-full space-y-2 p-2">
              {loading ? (
                <p className="py-6 text-center text-xs text-muted-foreground">טוען…</p>
              ) : jobs.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                  אין משימות עדיין.<br />
                  כל הורדה, המרה, חיתוך או תמלול יופיעו כאן.
                </p>
              ) : (
                jobs.map((j) => <JobCard key={j.id} job={j} />)
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
