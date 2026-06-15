import { useEffect, useState } from "react";
import { Activity, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useJobs } from "@/hooks/useJobs";
import { JobCard } from "./JobCard";

const STORAGE_KEY = "jobsCenter.open";

export function JobsCenter() {
  const { jobs, activeCount, loading } = useJobs();
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? "1" : "0"); } catch { /* noop */ }
  }, [open]);

  return (
    <>
      {/* Floating trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-4 left-4 z-[60] h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition"
        title="מרכז המשימות"
        aria-label="מרכז המשימות"
      >
        <Activity className="w-5 h-5" />
        {activeCount > 0 && (
          <Badge className="absolute -top-1 -right-1 h-5 min-w-5 px-1 text-[10px] tabular-nums">
            {activeCount}
          </Badge>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          dir="rtl"
          className="fixed bottom-20 left-4 z-[60] w-[min(420px,calc(100vw-2rem))] max-h-[70vh] bg-background border border-border rounded-xl shadow-2xl flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-sm">מרכז המשימות</h3>
              {activeCount > 0 && <Badge variant="secondary" className="text-[10px]">{activeCount} פעילות</Badge>}
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setOpen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {loading ? (
                <div className="text-center text-xs text-muted-foreground py-6">טוען…</div>
              ) : jobs.length === 0 ? (
                <div className="text-center text-xs text-muted-foreground py-6">
                  אין משימות עדיין. כל הורדה, המרה, חיתוך או תמלול יופיעו כאן.
                </div>
              ) : (
                jobs.map((j) => <JobCard key={j.id} job={j} />)
              )}
            </div>
          </ScrollArea>
        </div>
      )}
    </>
  );
}
