import { useEffect, useState } from "react";
import { Activity, X } from "lucide-react";
import { DOCK_SLOTS } from "@/lib/floatingDock";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useJobs } from "@/hooks/useJobs";
import { useCloudPreferences } from "@/hooks/useCloudPreferences";
import {
  readCloudJobsCenterVisible, readLocalJobsCenterVisible, writeLocalJobsCenterVisible,
} from "@/lib/jobsCenterPrefs";
import { JobCard } from "./JobCard";

const STORAGE_KEY = "jobsCenter.open";

export function JobsCenter() {
  const { jobs, activeCount, loading } = useJobs();
  const { preferences, isLoaded } = useCloudPreferences();

  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  /**
   * האם להציג בכלל.
   *
   * מתחילים מהערך המקומי כדי שהכפתור לא יהבהב, ומתקנים לפי הענן
   * ברגע שהוא נטען.
   */
  const [visible, setVisible] = useState<boolean>(() => readLocalJobsCenterVisible());
  useEffect(() => {
    if (!isLoaded) return;
    const cloud = readCloudJobsCenterVisible(preferences.tab_settings_json || "");
    if (cloud === null) return;
    setVisible(cloud);
    writeLocalJobsCenterVisible(cloud);
  }, [isLoaded, preferences.tab_settings_json]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? "1" : "0"); } catch { /* noop */ }
  }, [open]);

  if (!visible) return null;

  return (
    <>
      {/* הכפתור הצף */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`fixed ${DOCK_SLOTS.jobs} left-4 z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition hover:scale-105`}
        title="מרכז המשימות"
        aria-label="מרכז המשימות"
      >
        <Activity className="h-4 w-4" />
        {activeCount > 0 && (
          <Badge className="absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[9px] tabular-nums">
            {activeCount}
          </Badge>
        )}
      </button>

      {open && (
        <div
          dir="rtl"
          /*
            overflow-hidden הוא התיקון המרכזי.
            בלעדיו התוכן קבע את רוחב הפאנל במקום ההפך: שם קובץ ארוך
            מתח אותו ל-679 נקודות בתוך מסגרת של 420, וכל מה שבפנים —
            שמות, פסי התקדמות, כפתורים — נחתך בצד.
          */
          className="fixed bottom-[4.75rem] left-4 z-[60] flex max-h-[min(70vh,34rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Activity className="h-4 w-4 shrink-0 text-primary" />
              <h3 className="truncate text-sm font-semibold">מרכז המשימות</h3>
              {activeCount > 0 && (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {activeCount} פעילות
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 shrink-0 p-0"
              onClick={() => setOpen(false)}
              aria-label="סגור"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/*
            גלילה פשוטה ולא רכיב הגלילה המעוצב.
            הרכיב ההוא מרנדר שכבה פנימית שמתרחבת לפי התוכן, ולכן
            שם קובץ ארוך מתח את התוכן ל-868 נקודות מעבר למסגרת.
            גלילה רגילה עם רוחב קבוע פותרת את זה לגמרי.
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
