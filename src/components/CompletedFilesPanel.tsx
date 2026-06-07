/**
 * CompletedFilesPanel — floating, draggable, resizable panel that aggregates
 * every file produced by the cut/convert pipeline. Supports multi-select with
 * batch actions (download, ZIP, transcribe, save+transcribe+cloud, delete).
 *
 * Position/size persist in localStorage so the user gets the same layout next
 * time. Item metadata persists via completedFilesBus.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2, X, Minus, Maximize2, Mic, Save, Trash2, FileArchive,
  Scissors, FileAudio, GripVertical, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { completedFilesBus, type CompletedFile } from "@/lib/completedFilesBus";

interface Props {
  /** Open the file in the transcription page. */
  onTranscribe: (file: File) => void;
  /** Save locally + upload to cloud + go to transcription page. */
  onSaveAndTranscribe?: (file: File) => Promise<void> | void;
}

const POS_KEY = "completedFilesPanel.pos.v1";
const MIN_W = 320;
const MIN_H = 260;

interface PanelRect {
  x: number; y: number; w: number; h: number; minimized: boolean; closed: boolean;
}

const DEFAULT_RECT: PanelRect = {
  x: 16, y: typeof window !== "undefined" ? Math.max(40, window.innerHeight - 460) : 200,
  w: 460, h: 440, minimized: false, closed: false,
};

function loadRect(): PanelRect {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) return { ...DEFAULT_RECT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_RECT;
}

function fmtBytes(n: number) {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function CompletedFilesPanel({ onTranscribe, onSaveAndTranscribe }: Props) {
  const [items, setItems] = useState<CompletedFile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rect, setRect] = useState<PanelRect>(() => loadRect());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const rectRef = useRef(rect);
  rectRef.current = rect;

  useEffect(() => {
    const unsub = completedFilesBus.subscribe(setItems);
    return () => { unsub(); };
  }, []);

  // persist position/size
  useEffect(() => {
    try { localStorage.setItem(POS_KEY, JSON.stringify(rect)); } catch { /* ignore */ }
  }, [rect]);

  // ── Drag (from header) ─────────────────────────────────
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const onHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button,input,[role=checkbox]")) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: rect.x, origY: rect.y };
    const move = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = me.clientX - dragRef.current.startX;
      const dy = me.clientY - dragRef.current.startY;
      const maxX = window.innerWidth - 80;
      const maxY = window.innerHeight - 60;
      setRect((r) => ({
        ...r,
        x: Math.min(maxX, Math.max(-r.w + 80, dragRef.current!.origX + dx)),
        y: Math.min(maxY, Math.max(0, dragRef.current!.origY + dy)),
      }));
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ── Resize handles (8-directional) ─────────────────────
  type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
  const onResizeStart = (dir: Dir) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...rectRef.current };
    const move = (me: MouseEvent) => {
      let { x, y, w, h } = orig;
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      if (dir.includes("e")) w = Math.max(MIN_W, orig.w + dx);
      if (dir.includes("s")) h = Math.max(MIN_H, orig.h + dy);
      if (dir.includes("w")) { w = Math.max(MIN_W, orig.w - dx); x = orig.x + (orig.w - w); }
      if (dir.includes("n")) { h = Math.max(MIN_H, orig.h - dy); y = orig.y + (orig.h - h); }
      setRect((r) => ({ ...r, x, y, w, h }));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // ── Selection helpers ──────────────────────────────────
  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((s) => s.size === items.length ? new Set() : new Set(items.map((i) => i.id)));
  };

  const selectedItems = useMemo(
    () => items.filter((i) => selected.has(i.id) && i.file),
    [items, selected],
  );

  // ── Actions ────────────────────────────────────────────
  const downloadOne = (it: CompletedFile) => {
    if (!it.file) return;
    const url = URL.createObjectURL(it.file);
    const a = document.createElement("a");
    a.href = url; a.download = it.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const handleBatchDownload = async () => {
    if (selectedItems.length === 0) return;
    if (selectedItems.length === 1) return downloadOne(selectedItems[0]);
    setBatchBusy(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const it of selectedItems) if (it.file) zip.file(it.name, it.file);
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `files-${new Date().toISOString().slice(0, 10)}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({ title: `נשמרו ${selectedItems.length} קבצים ב-ZIP` });
    } catch (e) {
      toast({ title: "שגיאה ביצירת ZIP", description: String(e), variant: "destructive" });
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBatchTranscribe = () => {
    if (selectedItems.length === 0) return;
    // Open the first; downstream supports queue at /transcribe by repeated nav.
    // For multi-file we hand off to bus via sessionStorage so /transcribe can pick them up.
    try {
      const meta = selectedItems.map((i) => i.name);
      sessionStorage.setItem("pendingTranscribeBatch", JSON.stringify(meta));
    } catch { /* ignore */ }
    selectedItems.forEach((it, idx) => {
      if (idx === 0 && it.file) onTranscribe(it.file);
    });
    if (selectedItems.length > 1) {
      toast({ title: `נשלח לתמלול`, description: `הקובץ הראשון נטען; ${selectedItems.length - 1} נוספים — שלח ידנית בינתיים` });
    }
  };

  const handleBatchSaveAndTranscribe = async () => {
    if (!onSaveAndTranscribe || selectedItems.length === 0) return;
    setBatchBusy(true);
    try {
      for (const it of selectedItems) {
        if (it.file) await onSaveAndTranscribe(it.file);
      }
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBatchDelete = () => {
    if (selected.size === 0) return;
    completedFilesBus.remove(Array.from(selected));
    setSelected(new Set());
  };

  // ── Render ─────────────────────────────────────────────
  if (rect.closed && items.length === 0) return null;

  // Minimized pill
  if (rect.minimized) {
    return (
      <button
        className="fixed z-50 bottom-4 left-4 flex items-center gap-2 rounded-full border bg-background shadow-lg px-3 py-2 text-xs hover:bg-accent"
        onClick={() => setRect((r) => ({ ...r, minimized: false, closed: false }))}
        dir="rtl"
        aria-label="הצג קבצים שהושלמו"
      >
        <Maximize2 className="w-3.5 h-3.5" />
        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
        <span className="font-semibold">{items.length}</span>
        <span className="text-muted-foreground">קבצים מוכנים</span>
      </button>
    );
  }

  if (rect.closed) return null;

  const allSelected = items.length > 0 && selected.size === items.length;

  return (
    <div
      dir="rtl"
      role="dialog"
      aria-label="קבצים שהושלמו"
      className="fixed z-50 rounded-xl border bg-background shadow-2xl flex flex-col overflow-hidden"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      {/* Resize handles */}
      <div onMouseDown={onResizeStart("n")}  className="absolute top-0 left-2 right-2 h-1 cursor-n-resize" />
      <div onMouseDown={onResizeStart("s")}  className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize" />
      <div onMouseDown={onResizeStart("w")}  className="absolute top-2 bottom-2 left-0 w-1 cursor-w-resize" />
      <div onMouseDown={onResizeStart("e")}  className="absolute top-2 bottom-2 right-0 w-1 cursor-e-resize" />
      <div onMouseDown={onResizeStart("nw")} className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize" />
      <div onMouseDown={onResizeStart("ne")} className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize" />
      <div onMouseDown={onResizeStart("sw")} className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize" />
      <div onMouseDown={onResizeStart("se")} className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" />

      {/* Header (drag handle) */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/40 cursor-move select-none"
        onMouseDown={onHeaderMouseDown}
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripVertical className="w-4 h-4 text-muted-foreground" />
          <CheckCircle2 className="w-4 h-4 text-green-500" />
          <span className="text-sm font-semibold truncate">קבצים מוכנים ({items.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => setRect((r) => ({ ...r, minimized: true }))}
                  title="מזער" aria-label="מזער">
            <Minus className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => setRect((r) => ({ ...r, closed: true }))}
                  title="סגור" aria-label="סגור">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b bg-background/60">
        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="בחר הכל" />
          <span className="text-muted-foreground">
            {selected.size > 0 ? `נבחרו ${selected.size}` : "בחר הכל"}
          </span>
        </label>
        {items.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => { completedFilesBus.clear(); setSelected(new Set()); }}>
            נקה הכל
          </Button>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {items.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8">
            עוד אין קבצים — כל המרה או חיתוך שתסיים יופיעו כאן.
          </div>
        )}
        {items.map((it) => {
          const isSel = selected.has(it.id);
          const hasBlob = !!it.file;
          const Icon = it.kind === "cut" ? Scissors : FileAudio;
          return (
            <div
              key={it.id}
              className={`group flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors ${
                isSel ? "bg-primary/10 border-primary/40" : "bg-card hover:bg-accent/40"
              }`}
            >
              <Checkbox checked={isSel} onCheckedChange={() => toggle(it.id)} aria-label={`בחר ${it.name}`} />
              <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate" title={it.name}>{it.name}</div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                  <span>{fmtBytes(it.size)}</span>
                  <span>·</span>
                  <span>{it.kind === "cut" ? "חיתוך" : it.kind === "cut+convert" ? "חיתוך+המרה" : "המרה"}</span>
                  {!hasBlob && (
                    <>
                      <span>·</span>
                      <span className="text-amber-600 dark:text-amber-400">מקור לא זמין (נטען מחדש)</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-7 w-7"
                        disabled={!hasBlob} title="שמור" aria-label="שמור"
                        onClick={() => downloadOne(it)}>
                  <Save className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7"
                        disabled={!hasBlob} title="תמלל" aria-label="תמלל"
                        onClick={() => it.file && onTranscribe(it.file)}>
                  <Mic className="w-3.5 h-3.5" />
                </Button>
                {onSaveAndTranscribe && (
                  <Button variant="ghost" size="icon" className="h-7 w-7"
                          disabled={!hasBlob || busyId === it.id} title="שמור + תמלל + ענן"
                          onClick={async () => {
                            if (!it.file) return;
                            setBusyId(it.id);
                            try { await onSaveAndTranscribe(it.file); } finally { setBusyId(null); }
                          }}>
                    {busyId === it.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7"
                        title="מחק מהרשימה" aria-label="מחק"
                        onClick={() => completedFilesBus.remove([it.id])}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Batch footer */}
      {selected.size > 0 && (
        <div className="border-t bg-muted/30 px-2 py-2 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="default" className="gap-1.5 h-8"
                  disabled={batchBusy || selectedItems.length === 0}
                  onClick={handleBatchDownload}>
            {batchBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileArchive className="w-3.5 h-3.5" />}
            {selectedItems.length > 1 ? "שמור כ-ZIP" : "שמור"}
          </Button>
          <Button size="sm" variant="secondary" className="gap-1.5 h-8"
                  disabled={selectedItems.length === 0}
                  onClick={handleBatchTranscribe}>
            <Mic className="w-3.5 h-3.5" /> תמלל נבחרים
          </Button>
          {onSaveAndTranscribe && (
            <Button size="sm" variant="outline" className="gap-1.5 h-8"
                    disabled={batchBusy || selectedItems.length === 0}
                    onClick={handleBatchSaveAndTranscribe}>
              <CheckCircle2 className="w-3.5 h-3.5" /> שמור+תמלל+ענן
            </Button>
          )}
          <Button size="sm" variant="ghost" className="gap-1.5 h-8 text-destructive"
                  onClick={handleBatchDelete}>
            <Trash2 className="w-3.5 h-3.5" /> מחק
          </Button>
        </div>
      )}
    </div>
  );
}
