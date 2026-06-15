import { useRef, useState, useCallback, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Minimize2, Maximize2, GripHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingPlayerPortalProps {
  children?: ReactNode;
  onClose: () => void;
  title?: string;
  storageKey?: string;
  defaultWidth?: number;
  defaultHeight?: number;
  contentRef?: (el: HTMLDivElement | null) => void;
}

const STORAGE_KEY = "floating_player_pos_v1";

interface Pos { x: number; y: number; w: number; h: number; minimized: boolean }

function loadPos(key: string, defW: number, defH: number): Pos {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...defaultPos(defW, defH), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultPos(defW, defH);
}

function defaultPos(w = 480, h = 300): Pos {
  return {
    x: Math.max(16, window.innerWidth - w - 40),
    y: Math.max(16, window.innerHeight - h - 40),
    w,
    h,
    minimized: false,
  };
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

export function FloatingPlayerPortal({ children, onClose, title = '🎵 נגן צף', storageKey = STORAGE_KEY, defaultWidth = 480, defaultHeight = 300, contentRef }: FloatingPlayerPortalProps) {
  const [pos, setPos] = useState<Pos>(() => loadPos(storageKey, defaultWidth, defaultHeight));
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // persist position
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(pos));
  }, [pos, storageKey]);

  // --- Drag ---
  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos.x, pos.y]);

  const onDragMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setPos(p => ({
      ...p,
      x: clamp(drag.origX + dx, 0, window.innerWidth - 120),
      y: clamp(drag.origY + dy, 0, window.innerHeight - 40),
    }));
  }, []);

  const onDragEnd = useCallback(() => { dragRef.current = null; }, []);

  // --- Resize ---
  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: pos.w, origH: pos.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [pos.w, pos.h]);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const resize = resizeRef.current;
    if (!resize) return;
    const dx = e.clientX - resize.startX;
    const dy = e.clientY - resize.startY;
    setPos(p => ({
      ...p,
      w: clamp(resize.origW + dx, 320, window.innerWidth - p.x),
      h: clamp(resize.origH + dy, 80, window.innerHeight - p.y),
    }));
  }, []);

  const onResizeEnd = useCallback(() => { resizeRef.current = null; }, []);

  const toggleMinimize = useCallback(() => {
    setPos(p => ({ ...p, minimized: !p.minimized }));
  }, []);

  return createPortal(
    <div
      ref={panelRef}
      className={cn(
        "fixed z-[9999] flex flex-col rounded-xl border border-border/60 bg-background/95 backdrop-blur-md shadow-2xl",
        "ring-1 ring-primary/20",
      )}
      style={{
        top: pos.y,
        left: pos.x,
        width: pos.w,
        height: pos.minimized ? 42 : pos.h,
        transition: pos.minimized ? "height 0.2s ease" : undefined,
      }}
      dir="rtl"
    >
      {/* Title bar — draggable */}
      <div
        className="flex items-center justify-between px-2 h-[42px] min-h-[42px] border-b border-border/40 cursor-grab active:cursor-grabbing select-none rounded-t-xl bg-muted/40"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      >
        <div className="flex items-center gap-1.5">
          <GripHorizontal className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={toggleMinimize} title={pos.minimized ? "הרחב" : "מזער"}>
            {pos.minimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minimize2 className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-destructive/20 hover:text-destructive" onClick={onClose} title="סגור נגן צף (Ctrl+Shift+F)">
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {!pos.minimized && (
        <div className="flex-1 overflow-auto min-h-0" ref={contentRef}>
          {children}
        </div>
      )}

      {/* Resize handle — bottom right */}
      {!pos.minimized && (
        <div
          className="absolute bottom-0 left-0 w-4 h-4 cursor-nwse-resize"
          style={{ transform: "scaleX(-1)" }}
          onPointerDown={onResizeStart}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeEnd}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" className="text-muted-foreground/50">
            <path d="M14 16L16 14M10 16L16 10M6 16L16 6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
      )}
    </div>,
    document.body,
  );
}
