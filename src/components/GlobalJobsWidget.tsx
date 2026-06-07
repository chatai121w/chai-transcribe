import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTranscriptionJobs } from "@/hooks/useTranscriptionJobs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, CheckCircle2, XCircle, RefreshCw, Trash2, FileText,
  Clock, ChevronUp, ChevronDown, X, ListChecks
} from "lucide-react";

const statusConfig: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  uploading:  { label: "מעלה...",  icon: Loader2, className: "text-primary" },
  pending:    { label: "ממתין",    icon: Clock, className: "text-yellow-500" },
  processing: { label: "מעבד...",  icon: Loader2, className: "text-primary" },
  completed:  { label: "הושלם",    icon: CheckCircle2, className: "text-green-500" },
  failed:     { label: "נכשל",     icon: XCircle, className: "text-destructive" },
};

const STORAGE_KEY = "global-jobs-widget-state";
const STORAGE_SIZE_KEY = "global-jobs-widget-size";

const MIN_WIDTH = 300;
const MAX_WIDTH = 760;
const MIN_HEIGHT = 220;
const MAX_HEIGHT = 680;

type WidgetState = "expanded" | "collapsed" | "hidden";

export const GlobalJobsWidget = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { jobs, retryJob, deleteJob } = useTranscriptionJobs();

  const [state, setState] = useState<WidgetState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as WidgetState | null;
      return saved || "expanded";
    } catch {
      return "expanded";
    }
  });

  const [size, setSize] = useState<{ width: number; height: number }>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_SIZE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { width?: number; height?: number };
        if (typeof parsed.width === "number" && typeof parsed.height === "number") {
          return {
            width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed.width)),
            height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, parsed.height)),
          };
        }
      }
    } catch {
      // noop
    }
    return { width: 360, height: 420 };
  });

  const [topOffset, setTopOffset] = useState(120);
  const dragRef = useRef<{
    dir: string;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const clampSize = (width: number, height: number) => {
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : MAX_WIDTH;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : MAX_HEIGHT;

    const maxWidthByViewport = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, viewportWidth - 32));
    const maxHeightByViewport = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, viewportHeight - 32));

    return {
      width: Math.max(MIN_WIDTH, Math.min(maxWidthByViewport, width)),
      height: Math.max(MIN_HEIGHT, Math.min(maxHeightByViewport, height)),
    };
  };

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, state); } catch { /* noop */ }
  }, [state]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_SIZE_KEY, JSON.stringify(size)); } catch { /* noop */ }
  }, [size]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextTop = Math.max(16, window.innerHeight - size.height - 16);
    setTopOffset(nextTop);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onResize = () => {
      setSize((prev) => clampSize(prev.width, prev.height));
      setTopOffset((prev) => {
        const maxTop = Math.max(16, window.innerHeight - 72);
        return Math.max(16, Math.min(maxTop, prev));
      });
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      let nextWidth = drag.startWidth;
      let nextHeight = drag.startHeight;

      if (drag.dir.includes("e")) nextWidth = drag.startWidth + dx;
      if (drag.dir.includes("w")) nextWidth = drag.startWidth - dx;
      if (drag.dir.includes("s")) nextHeight = drag.startHeight + dy;
      if (drag.dir.includes("n")) nextHeight = drag.startHeight - dy;

      setSize(clampSize(nextWidth, nextHeight));
    };

    const onUp = () => {
      dragRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startResize = (dir: string, cursor: string, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      dir,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: size.width,
      startHeight: size.height,
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = cursor;
  };

  const bodyHeight = useMemo(() => Math.max(130, size.height - 96), [size.height]);

  // Re-show widget automatically when a new job is created
  const activeCount = jobs.filter(j => ['pending', 'uploading', 'processing'].includes(j.status)).length;
  const [lastActiveCount, setLastActiveCount] = useState(activeCount);
  useEffect(() => {
    if (activeCount > lastActiveCount && state === "hidden") {
      setState("collapsed");
    }
    setLastActiveCount(activeCount);
  }, [activeCount, lastActiveCount, state]);

  // Hide on the main /transcribe page (full panel already shown there) and on auth/login
  const isHiddenRoute = location.pathname === "/transcribe" || location.pathname === "/login" || location.pathname === "/reset-password";

  if (!user || jobs.length === 0 || isHiddenRoute) return null;

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  };

  const completedCount = jobs.filter(j => j.status === 'completed').length;
  const failedCount = jobs.filter(j => j.status === 'failed').length;

  // Hidden state: tiny pill with a button to bring it back
  if (state === "hidden") {
    return (
      <button
        onClick={() => setState("collapsed")}
        className="fixed bottom-4 left-4 z-40 rounded-full bg-primary text-primary-foreground shadow-lg px-3 py-2 flex items-center gap-2 hover:bg-primary/90 transition-colors"
        dir="rtl"
        title="הצג תמלולים בתהליך"
      >
        <ListChecks className="w-4 h-4" />
        <span className="text-xs font-semibold">
          {activeCount > 0 ? `${activeCount} פעיל${activeCount > 1 ? 'ים' : ''}` : `${jobs.length} עבודות`}
        </span>
      </button>
    );
  }

  return (
    <Card
      dir="rtl"
      className="fixed left-4 z-40 shadow-2xl border-primary/20 overflow-hidden"
      style={{
        width: `${size.width}px`,
        maxWidth: "calc(100vw - 2rem)",
        top: `${topOffset}px`,
      }}
    >
      {/* Resize handles */}
      {state === "expanded" && (
        <>
          <div className="absolute top-0 left-0 right-0 h-1.5 z-50 cursor-ns-resize" onMouseDown={(e) => startResize("n", "ns-resize", e)} />
          <div className="absolute bottom-0 left-0 right-0 h-1.5 z-50 cursor-ns-resize" onMouseDown={(e) => startResize("s", "ns-resize", e)} />
          <div className="absolute top-0 bottom-0 left-0 w-1.5 z-50 cursor-ew-resize" onMouseDown={(e) => startResize("w", "ew-resize", e)} />
          <div className="absolute top-0 bottom-0 right-0 w-1.5 z-50 cursor-ew-resize" onMouseDown={(e) => startResize("e", "ew-resize", e)} />

          <div className="absolute top-0 left-0 w-3 h-3 z-50 cursor-nwse-resize" onMouseDown={(e) => startResize("nw", "nwse-resize", e)} />
          <div className="absolute top-0 right-0 w-3 h-3 z-50 cursor-nesw-resize" onMouseDown={(e) => startResize("ne", "nesw-resize", e)} />
          <div className="absolute bottom-0 left-0 w-3 h-3 z-50 cursor-nesw-resize" onMouseDown={(e) => startResize("sw", "nesw-resize", e)} />
          <div className="absolute bottom-0 right-0 w-3 h-3 z-50 cursor-nwse-resize" onMouseDown={(e) => startResize("se", "nwse-resize", e)} />
        </>
      )}

      {/* Header */}
      <div className="flex flex-row-reverse items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30 rounded-t-lg">
        <div className="flex flex-row-reverse items-center gap-2 min-w-0">
          <ListChecks className="w-4 h-4 text-primary shrink-0" />
          <h3 className="text-sm font-semibold truncate">תמלולים בתהליך</h3>
          {activeCount > 0 && (
            <Badge variant="default" className="text-[10px] h-5 px-1.5">
              {activeCount} פעיל{activeCount > 1 ? 'ים' : ''}
            </Badge>
          )}
          {completedCount > 0 && state === "collapsed" && (
            <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
              ✓ {completedCount}
            </Badge>
          )}
          {failedCount > 0 && state === "collapsed" && (
            <Badge variant="destructive" className="text-[10px] h-5 px-1.5">
              ✕ {failedCount}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setState(state === "expanded" ? "collapsed" : "expanded")}
            title={state === "expanded" ? "מזער" : "הרחב"}
          >
            {state === "expanded" ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => setState("hidden")}
            title="סגור"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Body — only when expanded */}
      {state === "expanded" && (
        <ScrollArea style={{ height: `${bodyHeight}px` }}>
          <div className="p-2 space-y-1.5">
            {jobs.slice(0, 10).map(job => {
              const config = statusConfig[job.status] || statusConfig.pending;
              const StatusIcon = config.icon;
              const isActive = ['uploading', 'pending', 'processing'].includes(job.status);

              return (
                <div
                  key={job.id}
                  className="flex flex-row-reverse items-start gap-2 p-2 rounded-md border border-border bg-card hover:bg-muted/40 transition-colors"
                >
                  <StatusIcon
                    className={`w-4 h-4 shrink-0 mt-0.5 ${config.className} ${isActive ? 'animate-spin' : ''}`}
                  />
                  <div className="flex-1 min-w-0 text-right">
                    <p className="text-xs font-medium truncate">
                      {job.file_name || 'קובץ אודיו'}
                    </p>
                    <div className="flex flex-row-reverse items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="text-[9px] py-0 px-1 h-4">{job.engine}</Badge>
                      <span>{config.label}</span>
                      <span>·</span>
                      <span>{formatTime(job.created_at)}</span>
                    </div>
                    {isActive && (
                      <div className="mt-1">
                        <Progress value={job.progress} className="h-1" />
                      </div>
                    )}
                    {job.status === 'failed' && job.error_message && (
                      <p className="text-[10px] text-destructive mt-0.5 truncate" title={job.error_message}>
                        {job.error_message}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-center gap-0.5 shrink-0">
                    {job.status === 'completed' && job.result_text && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-6 w-6 p-0"
                        title="פתח בעורך"
                        onClick={() => navigate('/text-editor', { state: { text: job.result_text } })}
                      >
                        <FileText className="w-3 h-3" />
                      </Button>
                    )}
                    {job.status === 'failed' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0"
                        title="נסה שוב"
                        onClick={() => retryJob(job.id)}
                      >
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      title="מחק"
                      onClick={() => deleteJob(job.id)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      {/* Footer link to full panel */}
      {state === "expanded" && (
        <div className="px-3 py-1.5 border-t bg-muted/20 rounded-b-lg">
          <button
            onClick={() => navigate('/transcribe')}
            className="text-[11px] text-primary hover:underline w-full text-right"
          >
            פתח את עמוד התמלולים המלא ←
          </button>
        </div>
      )}
    </Card>
  );
};
