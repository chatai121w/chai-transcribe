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

const VIEWPORT_GAP = 12;
const TITLE_BAR_HEIGHT = 42;
const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 400;

function normalizePos(pos: Pos, defW: number, defH: number): Pos {
  const maxW = Math.max(240, window.innerWidth - VIEWPORT_GAP * 2);
  const maxH = Math.max(TITLE_BAR_HEIGHT, window.innerHeight - VIEWPORT_GAP * 2);
  const minW = Math.min(MIN_PANEL_WIDTH, maxW);
  const minH = Math.min(MIN_PANEL_HEIGHT, maxH);
  const w = clamp(Number.isFinite(pos.w) ? pos.w : defW, minW, maxW);
  const h = clamp(Number.isFinite(pos.h) ? pos.h : defH, minH, maxH);
  const visibleHeight = pos.minimized ? TITLE_BAR_HEIGHT : h;

  return {
    ...pos,
    w,
    h,
    x: clamp(Number.isFinite(pos.x) ? pos.x : VIEWPORT_GAP, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, window.innerWidth - w - VIEWPORT_GAP)),
    y: clamp(Number.isFinite(pos.y) ? pos.y : VIEWPORT_GAP, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, window.innerHeight - visibleHeight - VIEWPORT_GAP)),
  };
}

function loadPos(key: string, defW: number, defH: number): Pos {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return normalizePos({ ...defaultPos(defW, defH), ...JSON.parse(raw) }, defW, defH);
  } catch { /* ignore */ }
  return normalizePos(defaultPos(defW, defH), defW, defH);
}

function defaultPos(w = 480, h = 440): Pos {
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

  useEffect(() => {
    const keepInsideViewport = () => {
      setPos(current => normalizePos(current, defaultWidth, defaultHeight));
    };
    keepInsideViewport();
    window.addEventListener("resize", keepInsideViewport);
    return () => window.removeEventListener("resize", keepInsideViewport);
  }, [defaultHeight, defaultWidth]);

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
      x: clamp(drag.origX + dx, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, window.innerWidth - p.w - VIEWPORT_GAP)),
      y: clamp(drag.origY + dy, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, window.innerHeight - (p.minimized ? TITLE_BAR_HEIGHT : p.h) - VIEWPORT_GAP)),
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
      w: clamp(resize.origW + dx, Math.min(MIN_PANEL_WIDTH, window.innerWidth - VIEWPORT_GAP * 2), window.innerWidth - p.x - VIEWPORT_GAP),
      h: clamp(resize.origH + dy, Math.min(MIN_PANEL_HEIGHT, window.innerHeight - VIEWPORT_GAP * 2), window.innerHeight - p.y - VIEWPORT_GAP),
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
